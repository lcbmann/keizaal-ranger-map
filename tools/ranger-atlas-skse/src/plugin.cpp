#include "PCH.h"

#include "LocalBridge.h"

namespace
{
    constexpr auto kCaptureInterval = std::chrono::seconds(5);
    constexpr std::uint32_t kFieldConsoleKey = 0xD2;  // Insert keyboard scan code.
    constexpr std::uint32_t kFieldMenuKey = 0x41;  // F7 keyboard scan code.
    constexpr std::uint32_t kFieldMarkKey = 0x42;  // F8 keyboard scan code.
    constexpr std::uint32_t kFieldTrailmarkKey = 0x57;  // F11 keyboard scan code.
    constexpr RE::FormID kNativeMarkerTemplate = 0x000162A4;  // RiverwoodMapMarker.
    constexpr float kAtlasWidth = 8192.0F;
    constexpr float kAtlasHeight = 6144.0F;
    constexpr float kWorldToAtlasX0 = 73.826813F;
    constexpr float kWorldToAtlasX1 = 0.215295427F;
    constexpr float kWorldToAtlasX2 = 4067.73578F;
    constexpr float kWorldToAtlasY0 = -0.324059025F;
    constexpr float kWorldToAtlasY1 = 74.56657F;
    constexpr float kWorldToAtlasY2 = 3036.85421F;

    std::atomic_bool g_world_ready = false;
    std::atomic_bool g_field_menu_open = false;
    std::condition_variable_any g_capture_wake;
    std::mutex g_capture_mutex;
    std::jthread g_capture_worker;
    std::optional<std::filesystem::path> g_output_directory;
    std::unordered_map<std::string, RE::TESObjectREFR*> g_native_markers;

    void show_field_console()
    {
        RE::DebugMessageBox(
            "RANGER ATLAS\n\nF7  Open the Ranger Atlas menu\nF8  Mark current position\nF11 Open nearest Trailmark drop\n\nThe Atlas page must be open in your browser.");
    }

    void open_field_menu()
    {
        g_field_menu_open = true;
        RE::DebugMessageBox(
            "RANGER ATLAS MENU\n\nF8  Mark current position\nF11 Open nearby Trailmark drop\n\nPress OK, then press one of the action keys.\nThe open Atlas page will finish the action.");
    }

    void close_field_menu()
    {
        g_field_menu_open = false;
    }

    void remove_native_markers()
    {
        for (const auto& [id, marker] : g_native_markers) {
            if (marker && !marker->IsDeleted()) {
                marker->Disable();
            }
        }
        if (!g_native_markers.empty()) {
            SKSE::log::info("Cleared {} temporary native Atlas map markers.", g_native_markers.size());
        }
        g_native_markers.clear();
    }

    std::optional<RE::NiPoint3> atlas_to_world_position(
        float atlas_x,
        float atlas_y,
        float z)
    {
        if (!std::isfinite(atlas_x) || !std::isfinite(atlas_y) ||
            atlas_x < 0.0F || atlas_x > kAtlasWidth || atlas_y < 0.0F || atlas_y > kAtlasHeight) {
            return std::nullopt;
        }

        const auto right_x = atlas_x - kWorldToAtlasX2;
        const auto right_y = atlas_y - kWorldToAtlasY2;
        const auto determinant = kWorldToAtlasX0 * kWorldToAtlasY1 - kWorldToAtlasX1 * kWorldToAtlasY0;
        if (std::abs(determinant) < 0.001F) {
            return std::nullopt;
        }

        const auto cell_x = (right_x * kWorldToAtlasY1 - kWorldToAtlasX1 * right_y) / determinant;
        const auto cell_y = (kWorldToAtlasX0 * right_y - right_x * kWorldToAtlasY0) / determinant;
        return RE::NiPoint3{ cell_x * 4096.0F, cell_y * 4096.0F, z };
    }

    bool create_native_marker(const RangerAtlas::LocalBridge::NativeMarker& marker)
    {
        const auto player = RE::PlayerCharacter::GetSingleton();
        const auto template_ref = RE::TESForm::LookupByID<RE::TESObjectREFR>(kNativeMarkerTemplate);
        if (!player || !template_ref || !template_ref->GetObjectReference()) {
            SKSE::log::warn("Native marker '{}' skipped because the player or map marker template is unavailable.", marker.id);
            return false;
        }

        const auto position = atlas_to_world_position(marker.atlas_x, marker.atlas_y, player->GetPosition().z);
        if (!position) {
            SKSE::log::warn("Native marker '{}' skipped because its Atlas coordinates are invalid.", marker.id);
            return false;
        }

        const auto placed = player->PlaceObjectAtMe(template_ref->GetObjectReference(), false);
        if (!placed) {
            SKSE::log::warn("Native marker '{}' could not be placed from the vanilla template.", marker.id);
            return false;
        }

        placed->SetPosition(*position);
        placed->SetDisplayName(RE::BSFixedString(marker.title), true);

        const auto* template_map_marker = template_ref->extraList.GetByType<RE::ExtraMapMarker>();
        if (!template_map_marker || !template_map_marker->mapData) {
            SKSE::log::warn("Native marker '{}' skipped because the vanilla reference has no map marker data.", marker.id);
            placed->Disable();
            return false;
        }

        // MapMarkerData has game-owned virtual components. Reuse the live
        // vanilla TESFullName vtable and construct only its string field here.
        // This keeps memory ownership compatible with Skyrim's destructor.
        auto* map_marker = RE::BSExtraData::Create<RE::ExtraMapMarker>();
        map_marker->mapData = RE::malloc<RE::MapMarkerData>();
        if (!map_marker->mapData) {
            placed->Disable();
            return false;
        }
        std::memcpy(map_marker->mapData, template_map_marker->mapData, sizeof(void*));
        new (&map_marker->mapData->locationName.fullName) RE::BSFixedString(marker.title);
        map_marker->mapData->flags.set(RE::MapMarkerData::Flag::kVisible);
        map_marker->mapData->type = RE::MARKER_TYPE::kLandmark;
        placed->extraList.Add(map_marker);

        g_native_markers[marker.id] = placed.get();
        SKSE::log::info(
            "Created temporary native Trailmark '{}' at world x={:.1f}, y={:.1f}.",
            marker.title,
            position->x,
            position->y);
        return true;
    }

    void synchronize_native_markers()
    {
        if (RangerAtlas::LocalBridge::TakeNativeMarkerClearRequest()) {
            remove_native_markers();
        }

        for (const auto& marker : RangerAtlas::LocalBridge::TakeNativeMarkers()) {
            if (const auto existing = g_native_markers.find(marker.id); existing != g_native_markers.end()) {
                if (existing->second && !existing->second->IsDeleted()) {
                    existing->second->Disable();
                }
                g_native_markers.erase(existing);
            }
            create_native_marker(marker);
        }
    }

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
                    if (g_field_menu_open.load()) {
                        close_field_menu();
                        RE::DebugNotification("Ranger Atlas menu closed.");
                    } else {
                        open_field_menu();
                    }
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
                    show_field_console();
                    handled_any = true;
                }
            }

            return handled_any ? RE::BSEventNotifyControl::kStop : RE::BSEventNotifyControl::kContinue;
        }
    };

    FieldInputSink g_input_sink;

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
                tasks->AddTask([] {
                    capture_player_position();
                    synchronize_native_markers();
                });
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
            close_field_menu();
            remove_native_markers();
            return;
        }

        if (message->type == SKSE::MessagingInterface::kPostLoadGame ||
            message->type == SKSE::MessagingInterface::kNewGame) {
            g_world_ready = true;
            start_capture_worker();
            RangerAtlas::LocalBridge::Start();

            if (const auto input = RE::BSInputDeviceManager::GetSingleton()) {
                input->AddEventSink(&g_input_sink);
                SKSE::log::info(
                    "Ranger Atlas field controls registered: F7 menu, F8 mark, F11 Trailmark, Insert help.");
            } else {
                SKSE::log::warn("Ranger Atlas field controls could not access the input device manager.");
            }

            if (const auto tasks = SKSE::GetTaskInterface()) {
                tasks->AddTask([] {
                    capture_player_position();
                    synchronize_native_markers();
                });
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
