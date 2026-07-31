#include "PCH.h"

#include "FieldAtlasUI.h"
#include "LocalBridge.h"

namespace
{
    constexpr auto kCaptureInterval = std::chrono::seconds(5);
    constexpr std::uint32_t kFieldConsoleKey = 0xD2;  // Insert keyboard scan code.
    constexpr std::uint32_t kFieldMenuKey = 0x41;  // F7 keyboard scan code.
    constexpr std::uint32_t kFieldMarkKey = 0x42;  // F8 keyboard scan code.
    constexpr std::uint32_t kFieldTrailmarkKey = 0x57;  // F11 keyboard scan code.

    std::atomic_bool g_world_ready = false;
    std::condition_variable_any g_capture_wake;
    std::mutex g_capture_mutex;
    std::jthread g_capture_worker;
    std::optional<std::filesystem::path> g_output_directory;
    std::atomic_bool g_controls_registered = false;

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
                    RangerAtlas::FieldAtlasUI::Toggle();
                    handled_any = true;
                } else if (button->GetIDCode() == kFieldMarkKey) {
                    RangerAtlas::LocalBridge::QueueFieldAction("mark_here");
                    RE::DebugNotification("Ranger Atlas mark queued. Open the Atlas to finish it.");
                    handled_any = true;
                } else if (button->GetIDCode() == kFieldTrailmarkKey) {
                    RangerAtlas::LocalBridge::QueueFieldAction("open_nearby_trailmark");
                    RE::DebugNotification("Ranger Atlas Trailmark request queued.");
                    handled_any = true;
                } else if (button->GetIDCode() == kFieldConsoleKey) {
                    RangerAtlas::FieldAtlasUI::Toggle();
                    handled_any = true;
                }
            }

            return handled_any ? RE::BSEventNotifyControl::kStop : RE::BSEventNotifyControl::kContinue;
        }
    };

    FieldInputSink g_input_sink;

    void try_initialize_world()
    {
        if (g_world_ready.load()) {
            return;
        }

        const auto player = RE::PlayerCharacter::GetSingleton();
        const auto cell = player ? player->GetParentCell() : nullptr;
        const auto worldspace = player ? player->GetWorldspace() : nullptr;
        if (!player) {
            spdlog::info("World probe: player unavailable.");
            return;
        }
        if (!cell) {
            spdlog::info("World probe: player cell unavailable.");
            return;
        }
        if (!worldspace) {
            spdlog::info("World probe: player worldspace unavailable.");
            return;
        }
        spdlog::info(
            "World probe: cell=[{:08X}] interior={}, worldspace=[{:08X}].",
            cell->GetFormID(),
            cell->IsInteriorCell(),
            worldspace->GetFormID());
        if (cell->IsInteriorCell() || worldspace->GetFormID() != 0x0000003C) {
            return;
        }

        g_world_ready = true;
        RangerAtlas::LocalBridge::Start();
        RangerAtlas::FieldAtlasUI::Initialize();

        if (!g_controls_registered.exchange(true)) {
            if (const auto input = RE::BSInputDeviceManager::GetSingleton()) {
                input->AddEventSink(&g_input_sink);
                spdlog::info("Ranger Atlas field controls registered after outdoor Tamriel was confirmed.");
            } else {
                g_controls_registered = false;
                spdlog::warn("Ranger Atlas field controls could not access the input device manager.");
            }
        }

        spdlog::info("Keizaal world confirmed; Ranger Atlas local integration is now active.");
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
        const RE::NiPoint3& position,
        const RE::TESObjectCELL* cell,
        const RE::TESWorldSpace* worldspace)
    {
        if (!g_output_directory) {
            return;
        }

        const auto snapshot_path = *g_output_directory / "RangerAtlasPosition.json";
        std::ofstream snapshot(snapshot_path, std::ios::trunc);
        if (!snapshot) {
            spdlog::warn("Could not write position snapshot to {}", snapshot_path.string());
            return;
        }

        const auto updated_at = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();

        std::ostringstream snapshot_text;
        snapshot_text
            << "{\n"
            << "  \"version\": 1,\n"
            << "  \"updated_at_unix_ms\": " << updated_at << ",\n"
            << std::fixed << std::setprecision(3)
            << "  \"x\": " << position.x << ",\n"
            << "  \"y\": " << position.y << ",\n"
            << "  \"z\": " << position.z << ",\n"
            << "  \"interior\": " << (cell && cell->IsInteriorCell() ? "true" : "false") << ",\n"
            << "  \"cell_form_id\": " << (cell ? cell->GetFormID() : 0) << ",\n"
            << "  \"worldspace_form_id\": " << (worldspace ? worldspace->GetFormID() : 0) << "\n"
            << "}\n";

        const auto snapshot_json = snapshot_text.str();
        snapshot << snapshot_json;
        RangerAtlas::LocalBridge::UpdateSnapshot(snapshot_json);
    }

    void capture_player_position()
    {
        const auto player = RE::PlayerCharacter::GetSingleton();
        const auto cell = player ? player->GetParentCell() : nullptr;
        if (!player || !cell) {
            spdlog::warn("Position capture skipped because the player is not in a loaded cell.");
            return;
        }

        const auto position = player->GetPosition();
        const auto worldspace = player->GetWorldspace();
        const auto cell_name = cell->GetName() ? cell->GetName() : "";
        const auto worldspace_name =
            worldspace && worldspace->GetName() ? worldspace->GetName() : "";

        spdlog::info(
            "Player position: x={:.3f}, y={:.3f}, z={:.3f}, cell=\"{}\" [{:08X}], "
            "worldspace=\"{}\" [{:08X}], interior={}",
            position.x,
            position.y,
            position.z,
            cell_name,
            cell->GetFormID(),
            worldspace_name,
            worldspace ? worldspace->GetFormID() : 0,
            cell->IsInteriorCell());

        write_position_snapshot(position, cell, worldspace);
    }

    void capture_loop(std::stop_token stop_token)
    {
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

            if (const auto tasks = SKSE::GetTaskInterface()) {
                if (g_world_ready.load()) {
                    tasks->AddTask([] {
                        capture_player_position();
                    });
                } else {
                    tasks->AddTask(try_initialize_world);
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
        spdlog::info("Continuous local position tracker started with a five-second interval.");
    }

    void on_skse_message(SKSE::MessagingInterface::Message* message)
    {
        if (!message) {
            spdlog::warn("Received null SKSE message.");
            return;
        }

        spdlog::info("Received SKSE message type {}.", message->type);

        if (message->type == SKSE::MessagingInterface::kPreLoadGame) {
            g_world_ready = false;
            RangerAtlas::FieldAtlasUI::Close();
            if (g_controls_registered.exchange(false)) {
                if (const auto input = RE::BSInputDeviceManager::GetSingleton()) {
                    input->RemoveEventSink(&g_input_sink);
                }
            }
            return;
        }

        if (message->type == SKSE::MessagingInterface::kPostLoadGame ||
            message->type == SKSE::MessagingInterface::kNewGame) {
            g_world_ready = false;
            start_capture_worker();

            if (const auto tasks = SKSE::GetTaskInterface()) {
                tasks->AddTask(try_initialize_world);
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
        "Ranger Atlas loaded. Local integration is dormant until a post-load or new-game signal. Field Console build 0.9.0.");

    return true;
}
