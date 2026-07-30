#include "PCH.h"

#include "LocalBridge.h"

namespace
{
    constexpr auto kCaptureInterval = std::chrono::seconds(5);

    std::atomic_bool g_world_ready = false;
    std::condition_variable_any g_capture_wake;
    std::mutex g_capture_mutex;
    std::jthread g_capture_worker;
    std::optional<std::filesystem::path> g_output_directory;

    void initialize_logging()
    {
        auto log_directory = SKSE::log::log_directory();
        if (!log_directory) {
            return;
        }

        g_output_directory = *log_directory;
        *log_directory /= "RangerAtlas.log";
        auto sink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(
            log_directory->string(), true);
        auto logger = std::make_shared<spdlog::logger>("RangerAtlas", std::move(sink));

        spdlog::set_default_logger(std::move(logger));
        spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] %v");
        spdlog::set_level(spdlog::level::info);
        spdlog::flush_on(spdlog::level::info);
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
            SKSE::log::warn("Could not write position snapshot to {}", snapshot_path.string());
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
            SKSE::log::warn("Position capture skipped because the player is not in a loaded cell.");
            return;
        }

        const auto position = player->GetPosition();
        const auto worldspace = player->GetWorldspace();
        const auto cell_name = cell->GetName() ? cell->GetName() : "";
        const auto worldspace_name =
            worldspace && worldspace->GetName() ? worldspace->GetName() : "";

        SKSE::log::info(
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

            if (!g_world_ready.load()) {
                continue;
            }

            if (const auto tasks = SKSE::GetTaskInterface()) {
                tasks->AddTask(capture_player_position);
            }
        }
    }

    void start_capture_worker()
    {
        if (g_capture_worker.joinable()) {
            return;
        }

        g_capture_worker = std::jthread(capture_loop);
        SKSE::log::info("Continuous local position tracker started with a five-second interval.");
    }

    void on_skse_message(SKSE::MessagingInterface::Message* message)
    {
        if (!message) {
            return;
        }

        if (message->type == SKSE::MessagingInterface::kPreLoadGame) {
            g_world_ready = false;
            return;
        }

        if (message->type == SKSE::MessagingInterface::kPostLoadGame ||
            message->type == SKSE::MessagingInterface::kNewGame) {
            g_world_ready = true;
            start_capture_worker();
            RangerAtlas::LocalBridge::Start();

            if (const auto tasks = SKSE::GetTaskInterface()) {
                tasks->AddTask(capture_player_position);
                SKSE::log::info("Character entered the world; queued the initial position capture.");
            } else {
                SKSE::log::error("SKSE task interface is unavailable; position capture was not queued.");
            }
        }
    }
}

SKSEPluginLoad(const SKSE::LoadInterface* skse)
{
    initialize_logging();
    SKSE::Init(skse);

    const auto messaging = SKSE::GetMessagingInterface();
    if (!messaging || !messaging->RegisterListener(on_skse_message)) {
        SKSE::log::critical("Could not register the SKSE message listener.");
        return false;
    }

    SKSE::log::info(
        "Ranger Atlas continuous position reader loaded. Waiting for the character to enter the world.");

    return true;
}
