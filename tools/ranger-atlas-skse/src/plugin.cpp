#include "PCH.h"

#include "FieldAtlasUI.h"
#include "LocalBridge.h"
#include "ScaleformAtlasMenu.h"

namespace
{
    constexpr auto kCaptureInterval = std::chrono::milliseconds(250);
    constexpr auto kWorldProbeInterval = std::chrono::seconds(2);
    constexpr auto kDiagnosticInterval = std::chrono::seconds(30);
    constexpr std::uint32_t kEscapeKey = 0x01;
    constexpr std::uint32_t kFieldMenuKey = 0x41;  // F7 keyboard scan code.

    struct PositionSample
    {
        float x = 0.0F;
        float y = 0.0F;
        float z = 0.0F;
        bool interior = false;
        std::uint32_t cell_form_id = 0;
        std::uint32_t worldspace_form_id = 0;
        bool game_time_available = false;
        float game_hour = 0.0F;
        float game_timescale = 0.0F;
        std::uint32_t game_day = 0;
        std::uint32_t game_day_of_week = 0;
        std::uint32_t game_month = 0;
        std::uint32_t game_year = 0;
    };

    std::atomic_bool g_world_ready = false;
    std::atomic_bool g_load_in_progress = true;
    std::condition_variable_any g_capture_wake;
    std::mutex g_capture_mutex;
    std::mutex g_position_sample_mutex;
    std::jthread g_capture_worker;
    std::optional<PositionSample> g_pending_position_sample;
    std::optional<std::filesystem::path> g_output_directory;
    std::atomic_bool g_controls_registered = false;
    std::atomic_bool g_map_events_registered = false;
    std::atomic_bool g_capture_pending = false;
    std::chrono::steady_clock::time_point g_last_diagnostic_capture{};

    void capture_player_position();

    class FieldInputSink final : public RE::BSTEventSink<RE::InputEvent*>
    {
    public:
        RE::BSEventNotifyControl ProcessEvent(
            RE::InputEvent* const* event,
            RE::BSTEventSource<RE::InputEvent*>*) override
        {
            if (!event || !*event) {
                return RE::BSEventNotifyControl::kContinue;
            }

            bool handled_any = false;
            for (auto current = *event; current; current = current->next) {
                const auto button = current->AsButtonEvent();
                if (!button || button->GetDevice() != RE::INPUT_DEVICE::kKeyboard || !button->IsDown()) {
                    continue;
                }

                if (button->GetIDCode() == kFieldMenuKey) {
                    if (!RangerAtlas::FieldAtlasUI::OwnsInput()) {
                        RangerAtlas::FieldAtlasUI::HandleFieldKey();
                    }
                    handled_any = true;
                } else if (button->GetIDCode() == kEscapeKey &&
                           RangerAtlas::ScaleformAtlasMenu::HandleTextEntryEscape()) {
                    handled_any = true;
                }
            }

            return handled_any ? RE::BSEventNotifyControl::kStop : RE::BSEventNotifyControl::kContinue;
        }
    };

    FieldInputSink g_input_sink;

    class MapMenuSink final : public RE::BSTEventSink<RE::MenuOpenCloseEvent>
    {
    public:
        RE::BSEventNotifyControl ProcessEvent(
            const RE::MenuOpenCloseEvent* event,
            RE::BSTEventSource<RE::MenuOpenCloseEvent>*) override
        {
            if (!event || event->menuName != RE::MapMenu::MENU_NAME) {
                return RE::BSEventNotifyControl::kContinue;
            }
            if (event->opening) {
                if (RangerAtlas::ScaleformAtlasMenu::ConsumeNativeMapRequest()) {
                    RangerAtlas::FieldAtlasUI::SetMapMenuOpen(false);
                    spdlog::info("Ranger Atlas switched to Skyrim's native MapMenu for this opening.");
                    return RE::BSEventNotifyControl::kContinue;
                }
                if (!RangerAtlas::ScaleformAtlasMenu::MapKeyOpensAtlas()) {
                    RangerAtlas::FieldAtlasUI::SetMapMenuOpen(false);
                    spdlog::info("Ranger Atlas left M assigned to Skyrim's normal MapMenu.");
                    return RE::BSEventNotifyControl::kContinue;
                }
                const auto scaleform_queued = RangerAtlas::ScaleformAtlasMenu::QueueShow();
                RangerAtlas::FieldAtlasUI::SetMapMenuOpen(!scaleform_queued);
                spdlog::info(
                    "Ranger Atlas {} queued with MapMenu.",
                    scaleform_queued ? "Scaleform map surface" : "Map Companion fallback");
            } else if (RangerAtlas::ScaleformAtlasMenu::ConsumeMapMenuCloseSuppression()) {
                RangerAtlas::FieldAtlasUI::SetMapMenuOpen(false);
                spdlog::info("Skyrim MapMenu hidden after Ranger Atlas took input ownership.");
            } else {
                RangerAtlas::ScaleformAtlasMenu::Hide();
                RangerAtlas::FieldAtlasUI::SetMapMenuOpen(false);
                spdlog::info("Ranger Atlas map surfaces closed with MapMenu.");
            }
            return RE::BSEventNotifyControl::kContinue;
        }
    };

    MapMenuSink g_map_menu_sink;

    void register_map_menu_events()
    {
        if (g_map_events_registered.load()) {
            return;
        }
        if (const auto ui = RE::UI::GetSingleton()) {
            ui->AddEventSink<RE::MenuOpenCloseEvent>(&g_map_menu_sink);
            g_map_events_registered = true;
            spdlog::info("Ranger Atlas MapMenu event listener registered after outdoor world confirmation.");
        }
    }

    void try_initialize_world()
    {
        if (g_world_ready.load() || g_load_in_progress.load()) {
            return;
        }

        const auto player = RE::PlayerCharacter::GetSingleton();
        const auto cell = player ? player->GetParentCell() : nullptr;
        const auto worldspace = player ? player->GetWorldspace() : nullptr;
        if (!player || !cell || !worldspace) {
            return;
        }
        if (cell->IsInteriorCell() || worldspace->GetFormID() != 0x0000003C) {
            return;
        }

        g_world_ready = true;
        RangerAtlas::LocalBridge::Start();
        RangerAtlas::FieldAtlasUI::Initialize();
        register_map_menu_events();

        if (!g_controls_registered.exchange(true)) {
            if (const auto input = RE::BSInputDeviceManager::GetSingleton()) {
                input->AddEventSink(&g_input_sink);
                spdlog::info("Ranger Atlas field controls registered after outdoor Tamriel was confirmed.");
            } else {
                g_controls_registered = false;
                spdlog::warn("Ranger Atlas field controls could not access the input device manager.");
            }
        }

        spdlog::info(
            "Keizaal world confirmed; Ranger Atlas local bridge and in-game map integration are active.");
        capture_player_position();
    }

    void initialize_logging()
    {
        std::filesystem::path output_directory;
        if (const auto skse_directory = SKSE::log::log_directory()) {
            output_directory = *skse_directory;
            std::error_code path_error;
            if (std::filesystem::is_regular_file(output_directory, path_error) ||
                output_directory.extension() == ".log") {
                output_directory = output_directory.parent_path();
            } else {
                bool invalid_component = output_directory.has_extension();
                for (const auto& component : output_directory) {
                    auto extension = component.extension().string();
                    std::ranges::transform(extension, extension.begin(), [](char value) {
                        return value >= 'A' && value <= 'Z' ? static_cast<char>(value + ('a' - 'A')) : value;
                    });
                    invalid_component = invalid_component || extension == ".ini";
                }
                if (invalid_component) {
                    output_directory.clear();
                }
            }
        }

        auto use_standard_directory = [&output_directory]() {
            char* user_profile = nullptr;
            std::size_t user_profile_size = 0;
            if (_dupenv_s(&user_profile, &user_profile_size, "USERPROFILE") == 0 &&
                user_profile && *user_profile) {
                output_directory = std::filesystem::path(user_profile) /
                    "Documents" / "My Games" / "Skyrim Special Edition" / "SKSE";
            }
            std::free(user_profile);
        };

        if (output_directory.empty()) {
            use_standard_directory();
        }

        std::error_code directory_error;
        std::filesystem::create_directories(output_directory, directory_error);
        if (directory_error) {
            output_directory.clear();
            use_standard_directory();
            directory_error.clear();
            std::filesystem::create_directories(output_directory, directory_error);
        }
        if (output_directory.empty() || directory_error) {
            SKSE::log::error(
                "Ranger Atlas could not prepare a diagnostic directory: {}",
                directory_error ? directory_error.message() : "no directory available");
            return;
        }

        try {
            const auto log_path = output_directory / "RangerAtlas.log";
            std::ofstream probe(log_path, std::ios::app);
            if (!probe) {
                SKSE::log::error("Ranger Atlas could not open diagnostic log path {}.", log_path.string());
                return;
            }
            probe << "Ranger Atlas diagnostic file opened.\n";
            probe.flush();
            auto sink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(
                log_path.string(), true);
            auto logger = std::make_shared<spdlog::logger>("RangerAtlas", std::move(sink));

            spdlog::set_default_logger(std::move(logger));
            spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] %v");
            spdlog::set_level(spdlog::level::info);
            spdlog::flush_on(spdlog::level::info);
            g_output_directory = output_directory;
            spdlog::info("Ranger Atlas diagnostic logging initialized at {}.", log_path.string());
        } catch (const std::exception& error) {
            SKSE::log::error("Ranger Atlas diagnostic logging could not be initialized: {}", error.what());
        }
    }

    void write_position_snapshot(
        const PositionSample& sample,
        bool persist_to_disk)
    {
        const auto updated_at = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();

        std::ostringstream snapshot_text;
        snapshot_text
            << "{\n"
            << "  \"version\": 1,\n"
            << "  \"updated_at_unix_ms\": " << updated_at << ",\n"
            << std::fixed << std::setprecision(3)
            << "  \"x\": " << sample.x << ",\n"
            << "  \"y\": " << sample.y << ",\n"
            << "  \"z\": " << sample.z << ",\n"
            << "  \"interior\": " << (sample.interior ? "true" : "false") << ",\n"
            << "  \"cell_form_id\": " << sample.cell_form_id << ",\n"
            << "  \"worldspace_form_id\": " << sample.worldspace_form_id << ",\n"
            << "  \"game_time\": ";
        if (sample.game_time_available) {
            snapshot_text
                << "{\"hour\":" << sample.game_hour
                << ",\"day\":" << sample.game_day
                << ",\"day_of_week\":" << sample.game_day_of_week
                << ",\"month\":" << sample.game_month
                << ",\"year\":" << sample.game_year
                << ",\"timescale\":" << sample.game_timescale << "}\n";
        } else {
            snapshot_text << "null\n";
        }
        snapshot_text
            << "}\n";

        const auto snapshot_json = snapshot_text.str();
        RangerAtlas::LocalBridge::UpdateSnapshot(snapshot_json);

        if (!persist_to_disk || !g_output_directory) {
            return;
        }

        const auto snapshot_path = *g_output_directory / "RangerAtlasPosition.json";
        std::ofstream snapshot(snapshot_path, std::ios::trunc);
        if (!snapshot) {
            spdlog::warn("Could not write position snapshot to {}", snapshot_path.string());
            return;
        }
        snapshot << snapshot_json;
    }

    void capture_player_position()
    {
        const auto player = RE::PlayerCharacter::GetSingleton();
        const auto cell = player ? player->GetParentCell() : nullptr;
        if (!player || !cell) {
            return;
        }

        const auto position = player->GetPosition();
        const auto worldspace = player->GetWorldspace();
        PositionSample sample{
            .x = position.x,
            .y = position.y,
            .z = position.z,
            .interior = cell->IsInteriorCell(),
            .cell_form_id = cell->GetFormID(),
            .worldspace_form_id = worldspace ? worldspace->GetFormID() : 0,
        };
        if (const auto calendar = RE::Calendar::GetSingleton()) {
            sample.game_time_available = true;
            sample.game_hour = calendar->GetHour();
            sample.game_timescale = calendar->GetTimescale();
            sample.game_day = static_cast<std::uint32_t>((std::max)(1.0F, std::floor(calendar->GetDay())));
            sample.game_day_of_week = calendar->GetDayOfWeek();
            sample.game_month = calendar->GetMonth();
            sample.game_year = calendar->GetYear();
        }
        {
            std::scoped_lock lock(g_position_sample_mutex);
            g_pending_position_sample = sample;
        }
    }

    void publish_pending_position()
    {
        std::optional<PositionSample> sample;
        {
            std::scoped_lock lock(g_position_sample_mutex);
            sample.swap(g_pending_position_sample);
        }
        if (!sample) {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        const auto emit_diagnostics = now - g_last_diagnostic_capture >= kDiagnosticInterval;
        if (emit_diagnostics) {
            g_last_diagnostic_capture = now;
            spdlog::info(
                "Player position: x={:.3f}, y={:.3f}, z={:.3f}, cell=[{:08X}], "
                "worldspace=[{:08X}], interior={}",
                sample->x,
                sample->y,
                sample->z,
                sample->cell_form_id,
                sample->worldspace_form_id,
                sample->interior);
        }

        write_position_snapshot(*sample, emit_diagnostics);
    }

    void capture_loop(std::stop_token stop_token)
    {
        auto next_world_probe = std::chrono::steady_clock::now();
        while (!stop_token.stop_requested()) {
            std::unique_lock lock(g_capture_mutex);
            g_capture_wake.wait_for(
                lock,
                stop_token,
                kCaptureInterval,
                [] { return false; });
            lock.unlock();

            if (stop_token.stop_requested()) {
                return;
            }

            publish_pending_position();

            if (const auto tasks = SKSE::GetTaskInterface()) {
                const auto world_ready = g_world_ready.load();
                const auto now = std::chrono::steady_clock::now();
                if (!world_ready && (g_load_in_progress.load() || now < next_world_probe)) {
                    continue;
                }
                if (!world_ready) {
                    next_world_probe = now + kWorldProbeInterval;
                }
                if (!g_capture_pending.exchange(true)) {
                    tasks->AddTask([world_ready] {
                        if (world_ready) {
                            if (g_world_ready.load() && !g_load_in_progress.load()) {
                                capture_player_position();
                            }
                        } else {
                            try_initialize_world();
                        }
                        g_capture_pending = false;
                    });
                }
            }
        }
    }

    void start_capture_worker()
    {
        if (g_capture_worker.joinable()) {
            return;
        }

        g_capture_worker = std::jthread(capture_loop);
        spdlog::info("Continuous local position tracker started with a 250-millisecond interval.");
    }

    void on_skse_message(SKSE::MessagingInterface::Message* message)
    {
        if (!message) {
            spdlog::warn("Received null SKSE message.");
            return;
        }

        spdlog::info("Received SKSE message type {}.", message->type);

        if (message->type == SKSE::MessagingInterface::kDataLoaded) {
            RangerAtlas::ScaleformAtlasMenu::Register();
            return;
        }

        if (message->type == SKSE::MessagingInterface::kPreLoadGame) {
            g_load_in_progress = true;
            g_world_ready = false;
            {
                std::scoped_lock lock(g_position_sample_mutex);
                g_pending_position_sample.reset();
            }
            RangerAtlas::FieldAtlasUI::Close();
            RangerAtlas::ScaleformAtlasMenu::Reset();
            if (g_controls_registered.exchange(false)) {
                if (const auto input = RE::BSInputDeviceManager::GetSingleton()) {
                    input->RemoveEventSink(&g_input_sink);
                }
            }
            return;
        }

        if (message->type == SKSE::MessagingInterface::kPostLoadGame ||
            message->type == SKSE::MessagingInterface::kNewGame) {
            g_load_in_progress = false;
            g_world_ready = false;
            start_capture_worker();

            if (const auto tasks = SKSE::GetTaskInterface()) {
                if (!g_capture_pending.exchange(true)) {
                    tasks->AddTask([] {
                        try_initialize_world();
                        g_capture_pending = false;
                    });
                }
                spdlog::info("Load/new-game signal received; waiting for an outdoor Tamriel world before activating.");
            } else {
                spdlog::error("SKSE task interface is unavailable; deferred world activation was not queued.");
            }
        }
    }
}

SKSEPluginLoad(const SKSE::LoadInterface* skse)
{
    SKSE::Init(skse);
    initialize_logging();
    spdlog::info("Ranger Atlas SKSEPluginLoad entered.");

    const auto messaging = SKSE::GetMessagingInterface();
    if (!messaging || !messaging->RegisterListener(on_skse_message)) {
        spdlog::critical("Could not register the SKSE message listener.");
        return false;
    }

    spdlog::info(
        "Ranger Atlas loaded. Local integration is dormant until a post-load or new-game signal. Native Atlas local test build 0.18.6.");

    return true;
}
