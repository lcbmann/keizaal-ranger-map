#include "PCH.h"

#include "ScaleformAtlasMenu.h"

#include "FieldAtlasUI.h"
#include "LocalBridge.h"

#include <nlohmann/json.hpp>
#include <shellapi.h>

namespace RangerAtlas::ScaleformAtlasMenu
{
    namespace
    {
        using json = nlohmann::json;

        constexpr auto kMenuName = "RangerAtlasMenu";
        constexpr auto kMenuPath = "rangeratlasmenu";
        constexpr auto kMenuAssetPath = "Data/Interface/rangeratlasmenu.swf";
        constexpr auto kBrowserAtlasUrl = L"https://lcbmann.github.io/keizaal-ranger-map/";
        constexpr auto kArtworkCreditUrl = L"https://www.instagram.com/islor/";
        constexpr auto kRefreshInterval = std::chrono::milliseconds(200);
        constexpr auto kEscapeSuppressionWindow = std::chrono::milliseconds(300);
        constexpr REL::Version kMarketplaceInputRuntime{ 1, 6, 1130, 0 };
        constexpr std::size_t kLegacyTextEntryCountOffset = 0x120;
        constexpr std::size_t kMarketplaceTextEntryCountOffset = 0x128;

        class Menu;

        struct GfxKeyEventPrefix
        {
            RE::GFxEvent event;
            RE::GFxKey::Code key_code;
        };
        static_assert(sizeof(GfxKeyEventPrefix) == 0x8);

        bool has_ini_path_component(const std::filesystem::path& path)
        {
            for (const auto& component : path) {
                auto extension = component.extension().string();
                std::ranges::transform(extension, extension.begin(), [](char value) {
                    return value >= 'A' && value <= 'Z' ? static_cast<char>(value + ('a' - 'A')) : value;
                });
                if (extension == ".ini") {
                    return true;
                }
            }
            return false;
        }

        std::atomic_bool g_registered = false;
        std::atomic_bool g_show_queued = false;
        std::atomic_bool g_native_map_requested = false;
        std::atomic_bool g_suppress_next_map_close = false;
        std::atomic_bool g_map_key_opens_atlas = true;
        std::atomic<Menu*> g_active_menu = nullptr;

        std::uint8_t* text_entry_count()
        {
            const auto control_map = RE::ControlMap::GetSingleton();
            if (!control_map) {
                return nullptr;
            }

            const auto runtime = REL::Module::get().version();
            const auto offset = runtime >= kMarketplaceInputRuntime
                ? kMarketplaceTextEntryCountOffset
                : kLegacyTextEntryCountOffset;
            return reinterpret_cast<std::uint8_t*>(control_map) + offset;
        }

        bool acquire_text_input()
        {
            const auto counter = text_entry_count();
            if (!counter) {
                spdlog::warn("Ranger Atlas could not access Skyrim's text-entry counter.");
                return false;
            }
            if (*counter == (std::numeric_limits<std::uint8_t>::max)()) {
                spdlog::warn("Ranger Atlas refused to overflow Skyrim's text-entry counter.");
                return false;
            }

            ++*counter;
            spdlog::info(
                "Ranger Atlas acquired native text input (runtime {}, counter {}, offset 0x{:X}).",
                REL::Module::get().version().string("."),
                static_cast<unsigned>(*counter),
                REL::Module::get().version() >= kMarketplaceInputRuntime
                    ? kMarketplaceTextEntryCountOffset
                    : kLegacyTextEntryCountOffset);
            return true;
        }

        void release_text_input()
        {
            const auto counter = text_entry_count();
            if (!counter) {
                spdlog::warn("Ranger Atlas could not release Skyrim's text-entry counter.");
                return;
            }
            if (*counter == 0) {
                spdlog::warn("Ranger Atlas found Skyrim's text-entry counter at zero while releasing its claim.");
                return;
            }

            --*counter;
            spdlog::info(
                "Ranger Atlas released native text input (counter {}).",
                static_cast<unsigned>(*counter));
        }

        std::filesystem::path settings_path()
        {
            std::filesystem::path directory;
            if (const auto log_directory = SKSE::log::log_directory()) {
                directory = *log_directory;
                std::error_code path_error;
                if (std::filesystem::is_regular_file(directory, path_error) ||
                    directory.extension() == ".log") {
                    directory = directory.parent_path();
                } else if (directory.has_extension() || has_ini_path_component(directory)) {
                    directory.clear();
                }
            }
            if (directory.empty()) {
                char* user_profile = nullptr;
                std::size_t user_profile_size = 0;
                if (_dupenv_s(&user_profile, &user_profile_size, "USERPROFILE") == 0 &&
                    user_profile && *user_profile) {
                    directory = std::filesystem::path(user_profile) /
                        "Documents" / "My Games" / "Skyrim Special Edition" / "SKSE";
                }
                std::free(user_profile);
            }
            if (directory.empty()) {
                directory = std::filesystem::path("Data") / "SKSE" / "Plugins";
            }

            std::error_code directory_error;
            std::filesystem::create_directories(directory, directory_error);
            if (directory_error) {
                spdlog::warn(
                    "Ranger Atlas could not prepare its settings directory {}: {}",
                    directory.string(),
                    directory_error.message());
            }
            return directory / "RangerAtlas.ini";
        }

        void load_settings()
        {
            const auto path = settings_path();
            const auto value = GetPrivateProfileIntW(
                L"Controls",
                L"MapKeyOpensAtlas",
                1,
                path.wstring().c_str());
            g_map_key_opens_atlas = value != 0;
            spdlog::info(
                "Ranger Atlas opening mode loaded from {}: M={}, F7={}.",
                path.string(),
                g_map_key_opens_atlas.load() ? "Atlas" : "normal map",
                g_map_key_opens_atlas.load() ? "Travel View" : "Atlas");
        }

        void save_settings()
        {
            const auto path = settings_path();
            const auto value = g_map_key_opens_atlas.load() ? L"1" : L"0";
            if (!WritePrivateProfileStringW(
                    L"Controls",
                    L"MapKeyOpensAtlas",
                    value,
                    path.wstring().c_str())) {
                spdlog::warn("Ranger Atlas could not save its opening mode to {}.", path.string());
                return;
            }
            spdlog::info(
                "Ranger Atlas opening mode saved: M={}, F7={}.",
                g_map_key_opens_atlas.load() ? "Atlas" : "normal map",
                g_map_key_opens_atlas.load() ? "Travel View" : "Atlas");
        }

        std::string value_string(const json& value, std::string_view key, std::string fallback = {})
        {
            const auto entry = value.find(key);
            return entry != value.end() && entry->is_string() ? entry->get<std::string>() : std::move(fallback);
        }

        double value_number(const json& value, std::string_view key, double fallback = 0.0)
        {
            const auto entry = value.find(key);
            if (entry == value.end() || !entry->is_number()) {
                return fallback;
            }
            const auto result = entry->get<double>();
            return std::isfinite(result) ? result : fallback;
        }

        int value_integer(const json& value, std::string_view key, int fallback = -1)
        {
            const auto entry = value.find(key);
            return entry != value.end() && entry->is_number_integer() ? entry->get<int>() : fallback;
        }

        bool value_bool(const json& value, std::string_view key, bool fallback = false)
        {
            const auto entry = value.find(key);
            return entry != value.end() && entry->is_boolean() ? entry->get<bool>() : fallback;
        }

        void set_member(RE::GFxValue& object, const char* name, const RE::GFxValue& value)
        {
            object.SetMember(name, value);
        }

        void set_member(RE::GFxValue& object, const char* name, std::string_view value)
        {
            object.SetMember(name, RE::GFxValue(value));
        }

        void set_member(RE::GFxValue& object, const char* name, double value)
        {
            object.SetMember(name, RE::GFxValue(value));
        }

        void set_member(RE::GFxValue& object, const char* name, int value)
        {
            object.SetMember(name, RE::GFxValue(value));
        }

        void set_member(RE::GFxValue& object, const char* name, bool value)
        {
            object.SetMember(name, RE::GFxValue(value));
        }

        RE::GFxValue make_marker(
            RE::GFxMovieView& movie,
            const json& marker,
            std::string_view kind,
            std::string_view selected_id)
        {
            RE::GFxValue result;
            movie.CreateObject(&result);

            const auto marker_id = value_string(marker, "id");
            set_member(result, "id", marker_id);
            set_member(result, "title", value_string(marker, "title", "Atlas mark"));
            set_member(result, "kind", kind);
            set_member(result, "category", value_string(marker, "category", std::string(kind)));
            set_member(result, "source", value_string(marker, "source", "personal"));
            set_member(result, "notes", value_string(marker, "notes"));
            set_member(result, "x", value_number(marker, "x", -1.0));
            set_member(result, "y", value_number(marker, "y", -1.0));
            set_member(result, "distanceMeters", value_number(marker, "distance_meters", -1.0));
            set_member(result, "withinRange", value_bool(marker, "within_range"));
            set_member(result, "headquarters", value_bool(marker, "headquarters"));
            set_member(result, "selected", !marker_id.empty() && marker_id == selected_id);
            return result;
        }

        RE::GFxValue make_ranger(RE::GFxMovieView& movie, const json& ranger)
        {
            RE::GFxValue result;
            movie.CreateObject(&result);
            set_member(result, "id", value_string(ranger, "id"));
            set_member(result, "title", value_string(ranger, "title", "Unknown Ranger"));
            set_member(result, "x", value_number(ranger, "x", -1.0));
            set_member(result, "y", value_number(ranger, "y", -1.0));
            set_member(result, "heading", value_number(ranger, "heading"));
            set_member(result, "activity", value_string(ranger, "activity", "just now"));
            return result;
        }

        void append_markers(
            RE::GFxMovieView& movie,
            RE::GFxValue& destination,
            const json& source,
            std::string_view key,
            std::string_view kind,
            std::string_view selected_id)
        {
            const auto entries = source.find(key);
            if (entries == source.end() || !entries->is_array()) {
                return;
            }
            for (const auto& marker : *entries) {
                if (!marker.is_object()) {
                    continue;
                }
                const auto x = value_number(marker, "x", -1.0);
                const auto y = value_number(marker, "y", -1.0);
                if (x < 0.0 || y < 0.0) {
                    continue;
                }
                destination.PushBack(make_marker(movie, marker, kind, selected_id));
            }
        }

        RE::GFxValue make_selected_entry(RE::GFxMovieView& movie, const json& source)
        {
            RE::GFxValue result;
            movie.CreateObject(&result);
            set_member(result, "id", value_string(source, "id"));
            set_member(result, "title", value_string(source, "title", "Atlas entry"));
            set_member(result, "category", value_string(source, "category", "landmark"));
            set_member(result, "source", value_string(source, "source", "personal"));
            set_member(result, "notes", value_string(source, "notes"));
            set_member(result, "x", value_number(source, "x", -1.0));
            set_member(result, "y", value_number(source, "y", -1.0));
            set_member(result, "distanceMeters", value_number(source, "distance_meters", -1.0));
            set_member(result, "withinRange", value_bool(source, "within_range"));
            set_member(result, "headquarters", value_bool(source, "headquarters"));
            return result;
        }

        std::string skyrim_time_line()
        {
            const auto calendar = RE::Calendar::GetSingleton();
            if (!calendar) {
                return {};
            }

            const auto hour_value = std::fmod((std::max)(0.0F, calendar->GetHour()), 24.0F);
            const auto hour = static_cast<int>(std::floor(hour_value));
            const auto minute = static_cast<int>(std::floor((hour_value - static_cast<float>(hour)) * 60.0F));
            std::ostringstream value;
            value << calendar->GetDayName() << ", "
                  << (std::max)(1, static_cast<int>(std::floor(calendar->GetDay()))) << " "
                  << calendar->GetMonthName() << ", 4E " << calendar->GetYear()
                  << "  |  " << std::setfill('0') << std::setw(2) << hour << ':' << std::setw(2) << minute;
            return value.str();
        }

        class Menu final : public RE::IMenu
        {
        public:
            Menu()
            {
                g_active_menu = this;
                const auto manager = RE::BSScaleformManager::GetSingleton();
                const auto loaded = manager && manager->LoadMovieEx(
                    this,
                    kMenuPath,
                    RE::GFxMovieView::ScaleModeType::kNoBorder,
                    0.0F,
                    [this](RE::GFxMovieDef* definition) {
                        using StateType = RE::GFxState::StateType;
                        fxDelegate.reset(new RE::FxDelegate());
                        fxDelegate->RegisterHandler(this);
                        definition->SetState(StateType::kExternalInterface, fxDelegate.get());
                        fxDelegate->Release();
                    });
                if (!loaded) {
                    spdlog::error("Ranger Atlas Scaleform surface could not load {}.swf.", kMenuPath);
                }

                inputContext = Context::kMenuMode;
                depthPriority = 6;
                menuFlags.set(
                    RE::UI_MENU_FLAGS::kPausesGame,
                    RE::UI_MENU_FLAGS::kModal,
                    RE::UI_MENU_FLAGS::kTopmostRenderedMenu,
                    RE::UI_MENU_FLAGS::kUsesMenuContext,
                    RE::UI_MENU_FLAGS::kDisablePauseMenu,
                    RE::UI_MENU_FLAGS::kRequiresUpdate,
                    RE::UI_MENU_FLAGS::kUpdateUsesCursor,
                    RE::UI_MENU_FLAGS::kUsesCursor,
                    RE::UI_MENU_FLAGS::kDontHideCursorWhenTopmost);
            }

            ~Menu() override
            {
                SetTextEntryActive(false);
                auto* expected = this;
                g_active_menu.compare_exchange_strong(expected, nullptr);
            }

            void Accept(RE::FxDelegateHandler::CallbackProcessor* processor) override
            {
                processor->Process("CloseAtlasOverlay", CloseOverlay);
                processor->Process("CloseAtlasMap", CloseMap);
                processor->Process("OpenBrowserAtlas", OpenBrowser);
                processor->Process("OpenArtworkCredit", OpenArtworkCredit);
                processor->Process("RefreshAtlas", Refresh);
                processor->Process("SelectAtlasEntry", SelectEntry);
                processor->Process("CheckInTrailmark", CheckInTrailmark);
                processor->Process("RefreshTrailmarkVisitors", RefreshTrailmarkVisitors);
                processor->Process("SubmitTrailmarkDrop", SubmitTrailmarkDrop);
                processor->Process("SaveFieldClipboard", SaveFieldClipboard);
                processor->Process("CreateFieldMark", CreateFieldMark);
                processor->Process("OpenTravelView", OpenTravelView);
                processor->Process("SetMapKeyBehavior", SetMapKeyBehavior);
                processor->Process("BeginTextEntry", BeginTextEntry);
                processor->Process("EndTextEntry", EndTextEntry);
                processor->Process("ReportAtlasSurfaceStatus", ReportSurfaceStatus);
            }

            RE::UI_MESSAGE_RESULTS ProcessMessage(RE::UIMessage& message) override
            {
                if (message.type == RE::UI_MESSAGE_TYPE::kHide ||
                    message.type == RE::UI_MESSAGE_TYPE::kForceHide) {
                    SetTextEntryActive(false);
                }

                if (message.type == RE::UI_MESSAGE_TYPE::kScaleformEvent) {
                    const auto data = static_cast<RE::BSUIScaleformData*>(message.data);
                    const auto event = data ? data->scaleformEvent : nullptr;
                    if (event && event->type == RE::GFxEvent::EventType::kKeyDown) {
                        // CommonLib 3.6 does not expose GFxKeyEvent, but its stable prefix is
                        // GFxEvent followed by the 32-bit Scaleform key code.
                        const auto key_event = reinterpret_cast<const GfxKeyEventPrefix*>(event);
                        if (key_event->key_code == RE::GFxKey::kEscape &&
                            std::chrono::steady_clock::now() <= suppress_escape_until_) {
                            suppress_escape_until_ = {};
                            spdlog::info("Ranger Atlas consumed the follow-up Scaleform Escape after closing a modal.");
                            return RE::UI_MESSAGE_RESULTS::kHandled;
                        }
                        if (key_event->key_code == RE::GFxKey::kEscape &&
                            (text_entry_active_ || ModalIsOpen())) {
                            spdlog::info(
                                "Ranger Atlas consumed modal Escape in the menu event path (Scaleform key {}).",
                                static_cast<std::uint32_t>(key_event->key_code));
                            CancelTextEntry();
                            return RE::UI_MESSAGE_RESULTS::kHandled;
                        }
                    }
                }
                return RE::IMenu::ProcessMessage(message);
            }

            void AdvanceMovie(float interval, std::uint32_t current_time) override
            {
                RE::IMenu::AdvanceMovie(interval, current_time);
                if (text_entry_active_ || ModalIsOpen()) {
                    return;
                }
                const auto now = std::chrono::steady_clock::now();
                if (now < next_refresh_) {
                    return;
                }
                next_refresh_ = now + kRefreshInterval;
                PushState(false);
            }

            static RE::stl::owner<RE::IMenu*> Creator()
            {
                return new Menu();
            }

            void PushState(bool force)
            {
                if (!uiMovie) {
                    return;
                }

                const auto raw_state = LocalBridge::GetFieldState();
                const auto time_line = skyrim_time_line();
                const auto map_key_opens_atlas = MapKeyOpensAtlas();
                const auto state_key = raw_state + '\n' + time_line +
                    (map_key_opens_atlas ? "\nmap=atlas" : "\nmap=normal");
                if (!force && state_key == last_state_key_) {
                    return;
                }

                try {
                    const auto state = json::parse(raw_state.empty() ? R"({"ready":false})" : raw_state);
                    RE::GFxValue atlas_state;
                    uiMovie->CreateObject(&atlas_state);

                    const auto selected = state.find("selected_entry");
                    const auto selected_id = selected != state.end() && selected->is_object()
                        ? value_string(*selected, "id")
                        : std::string{};

                    set_member(atlas_state, "ready", value_bool(state, "ready"));
                    set_member(atlas_state, "browserReady", value_bool(state, "atlas_ready", value_bool(state, "ready")));
                    set_member(atlas_state, "rangerName", value_string(state, "ranger_name", "Unnamed Ranger"));
                    set_member(atlas_state, "gameLink", value_string(state, "game_link", "Waiting for Skyrim"));
                    set_member(atlas_state, "skyrimTime", time_line);
                    set_member(atlas_state, "awakeRangerCount", value_integer(state, "awake_ranger_count"));
                    set_member(atlas_state, "inSkyrimCount", value_integer(state, "in_skyrim_count"));
                    set_member(atlas_state, "discordOnlineCount", value_integer(state, "discord_online_count"));
                    set_member(atlas_state, "calibrationVersion", value_integer(state, "calibration_version", 0));
                    set_member(atlas_state, "trailmarkRevision", value_integer(state, "trailmark_revision", 0));
                    set_member(atlas_state, "settlementRevision", value_integer(state, "settlement_revision", 0));
                    set_member(atlas_state, "selectedId", selected_id);
                    set_member(atlas_state, "actionStatus", value_string(state, "field_action_status"));
                    set_member(atlas_state, "overwatchEnabled", value_bool(state, "overwatch_enabled"));
                    set_member(atlas_state, "mapKeyOpensAtlas", map_key_opens_atlas);

                    auto rank = std::string{};
                    std::vector<std::string> honor_labels;
                    RE::GFxValue honors;
                    uiMovie->CreateArray(&honors);
                    const auto profile = state.find("ranger_profile");
                    if (profile != state.end() && profile->is_object()) {
                        const auto primary_badge = profile->find("primary_badge");
                        if (primary_badge != profile->end() && primary_badge->is_object()) {
                            rank = value_string(*primary_badge, "label");
                        }
                        const auto append_honors = [&](const char* key) {
                            const auto badges = profile->find(key);
                            if (badges == profile->end() || !badges->is_array()) {
                                return;
                            }
                            for (const auto& badge : *badges) {
                                if (!badge.is_object()) {
                                    continue;
                                }
                                const auto label = value_string(badge, "label");
                                if (!label.empty() &&
                                    std::find(honor_labels.begin(), honor_labels.end(), label) == honor_labels.end()) {
                                    honor_labels.push_back(label);
                                }
                            }
                        };
                        append_honors("qualifications");
                        append_honors("medals");
                        for (const auto& label : honor_labels) {
                            honors.PushBack(RE::GFxValue(label));
                        }
                    }
                    set_member(atlas_state, "rank", rank);
                    set_member(atlas_state, "honors", honors);

                    const auto clipboard = state.find("clipboard");
                    if (clipboard != state.end() && clipboard->is_object()) {
                        RE::GFxValue clipboard_value;
                        uiMovie->CreateObject(&clipboard_value);
                        set_member(clipboard_value, "title", value_string(*clipboard, "title", "Field notes"));
                        set_member(clipboard_value, "body", value_string(*clipboard, "body"));
                        set_member(clipboard_value, "updatedAt", value_string(*clipboard, "updated_at"));
                        set_member(atlas_state, "clipboard", clipboard_value);
                    }

                    const auto player = state.find("player_point");
                    if (player != state.end() && player->is_object()) {
                        RE::GFxValue player_value;
                        uiMovie->CreateObject(&player_value);
                        set_member(player_value, "x", value_number(*player, "x", -1.0));
                        set_member(player_value, "y", value_number(*player, "y", -1.0));
                        set_member(player_value, "heading", value_number(*player, "heading"));
                        set_member(player_value, "stale", value_bool(*player, "stale"));
                        set_member(atlas_state, "player", player_value);
                    }

                    RE::GFxValue markers;
                    uiMovie->CreateArray(&markers);
                    append_markers(*uiMovie, markers, state, "official_trailmarks", "trailmark", selected_id);
                    append_markers(*uiMovie, markers, state, "settlements", "settlement", selected_id);
                    append_markers(*uiMovie, markers, state, "map_markers", "marker", selected_id);
                    set_member(atlas_state, "markers", markers);

                    RE::GFxValue routes;
                    uiMovie->CreateArray(&routes);
                    const auto route_entries = state.find("routes");
                    if (route_entries != state.end() && route_entries->is_array()) {
                        for (const auto& route : *route_entries) {
                            if (!route.is_object()) {
                                continue;
                            }
                            RE::GFxValue route_value;
                            uiMovie->CreateObject(&route_value);
                            set_member(route_value, "id", value_string(route, "id"));
                            set_member(route_value, "title", value_string(route, "title", "Route"));
                            set_member(route_value, "color", value_string(route, "color", "#bf973a"));

                            RE::GFxValue points;
                            uiMovie->CreateArray(&points);
                            const auto route_points = route.find("points");
                            if (route_points != route.end() && route_points->is_array()) {
                                for (const auto& point : *route_points) {
                                    if (!point.is_object()) {
                                        continue;
                                    }
                                    RE::GFxValue point_value;
                                    uiMovie->CreateObject(&point_value);
                                    set_member(point_value, "x", value_number(point, "x", -1.0));
                                    set_member(point_value, "y", value_number(point, "y", -1.0));
                                    points.PushBack(point_value);
                                }
                            }
                            set_member(route_value, "points", points);
                            routes.PushBack(route_value);
                        }
                    }
                    set_member(atlas_state, "routes", routes);

                    RE::GFxValue rangers;
                    uiMovie->CreateArray(&rangers);
                    if (value_bool(state, "overwatch_enabled")) {
                        const auto ranger_entries = state.find("overwatch_rangers");
                        if (ranger_entries != state.end() && ranger_entries->is_array()) {
                            for (const auto& ranger : *ranger_entries) {
                                if (!ranger.is_object()) {
                                    continue;
                                }
                                const auto x = value_number(ranger, "x", -1.0);
                                const auto y = value_number(ranger, "y", -1.0);
                                if (x >= 0.0 && y >= 0.0) {
                                    rangers.PushBack(make_ranger(*uiMovie, ranger));
                                }
                            }
                        }
                    }
                    set_member(atlas_state, "rangers", rangers);

                    if (selected != state.end() && selected->is_object()) {
                        set_member(atlas_state, "selected", make_selected_entry(*uiMovie, *selected));
                    }

                    const auto nearest = state.find("nearest_trailmark");
                    if (nearest != state.end() && nearest->is_object()) {
                        RE::GFxValue nearest_value;
                        uiMovie->CreateObject(&nearest_value);
                        set_member(nearest_value, "id", value_string(*nearest, "id"));
                        set_member(nearest_value, "title", value_string(*nearest, "title", "Trailmark"));
                        set_member(nearest_value, "notes", value_string(*nearest, "notes"));
                        set_member(nearest_value, "distanceMeters", value_number(*nearest, "distance_meters", -1.0));
                        set_member(nearest_value, "withinRange", value_bool(*nearest, "within_range"));
                        set_member(nearest_value, "canCheckIn", value_bool(*nearest, "can_check_in"));
                        set_member(nearest_value, "canLeaveDrop", value_bool(*nearest, "can_leave_drop"));
                        set_member(nearest_value, "discordLinked", value_bool(*nearest, "discord_linked"));
                        set_member(nearest_value, "visitsEnabled", value_bool(*nearest, "visits_enabled"));

                        RE::GFxValue visitors;
                        uiMovie->CreateArray(&visitors);
                        const auto visitor_lines = nearest->find("recent_visitor_lines");
                        if (visitor_lines != nearest->end() && visitor_lines->is_array()) {
                            for (const auto& line : *visitor_lines) {
                                if (line.is_string()) {
                                    visitors.PushBack(RE::GFxValue(line.get<std::string>()));
                                }
                            }
                        }
                        set_member(nearest_value, "visitorLines", visitors);
                        set_member(atlas_state, "nearest", nearest_value);
                    }

                    std::array<RE::GFxValue, 1> args{ atlas_state };
                    if (uiMovie->Invoke(
                            "_root.RangerAtlasMenu_mc.SetState",
                            nullptr,
                            args.data(),
                            static_cast<std::uint32_t>(args.size()))) {
                        last_state_key_ = state_key;
                    }
                } catch (const std::exception& error) {
                    spdlog::warn("Ranger Atlas Scaleform snapshot could not be rendered: {}", error.what());
                }
            }

        private:
            static Menu* Current()
            {
                return g_active_menu.load();
            }

            static void CloseOverlay(const RE::FxDelegateArgs&)
            {
                Hide();
                g_native_map_requested = true;
                if (const auto queue = RE::UIMessageQueue::GetSingleton()) {
                    queue->AddMessage(RE::MapMenu::MENU_NAME, RE::UI_MESSAGE_TYPE::kShow, nullptr);
                }
            }

            static void CloseMap(const RE::FxDelegateArgs&)
            {
                Hide();
                if (const auto queue = RE::UIMessageQueue::GetSingleton()) {
                    queue->AddMessage(RE::MapMenu::MENU_NAME, RE::UI_MESSAGE_TYPE::kHide, nullptr);
                }
            }

            static void OpenBrowser(const RE::FxDelegateArgs&)
            {
                const auto result = reinterpret_cast<std::intptr_t>(ShellExecuteW(
                    nullptr,
                    L"open",
                    kBrowserAtlasUrl,
                    nullptr,
                    nullptr,
                    SW_SHOWNORMAL));
                if (result <= 32) {
                    spdlog::warn("Ranger Atlas could not open the browser Atlas (ShellExecute result {}).", result);
                }
            }

            static void OpenArtworkCredit(const RE::FxDelegateArgs&)
            {
                const auto result = reinterpret_cast<std::intptr_t>(ShellExecuteW(
                    nullptr,
                    L"open",
                    kArtworkCreditUrl,
                    nullptr,
                    nullptr,
                    SW_SHOWNORMAL));
                if (result <= 32) {
                    spdlog::warn("Ranger Atlas could not open the illustrated-map artwork credit (ShellExecute result {}).", result);
                }
            }

            static void Refresh(const RE::FxDelegateArgs&)
            {
                LocalBridge::QueueFieldAction("refresh_atlas_snapshot");
                if (const auto current = Current()) {
                    current->last_state_key_.clear();
                    current->PushState(true);
                }
            }

            static void SelectEntry(const RE::FxDelegateArgs& params)
            {
                if (params.GetArgCount() < 1 || !params[0].IsString()) {
                    return;
                }
                const auto id = std::string(params[0].GetString());
                if (id.empty() || id.size() > 160) {
                    return;
                }
                LocalBridge::QueueFieldAction(
                    "select_atlas_entry",
                    json{ { "feature_id", id } }.dump());
            }

            static void CheckInTrailmark(const RE::FxDelegateArgs&)
            {
                LocalBridge::QueueFieldAction("record_nearby_trailmark_visit");
            }

            static void RefreshTrailmarkVisitors(const RE::FxDelegateArgs&)
            {
                LocalBridge::QueueFieldAction("refresh_nearby_trailmark_visits");
            }

            static void SubmitTrailmarkDrop(const RE::FxDelegateArgs& params)
            {
                if (params.GetArgCount() < 2 || !params[0].IsString() || !params[1].IsString()) {
                    return;
                }
                const auto trailmark_id = std::string(params[0].GetString());
                const auto message = std::string(params[1].GetString());
                if (trailmark_id.empty() || trailmark_id.size() > 160 || message.empty() || message.size() > 7200) {
                    return;
                }
                LocalBridge::QueueFieldAction(
                    "submit_nearby_trailmark_drop",
                    json{ { "atlas_location_id", trailmark_id }, { "message", message } }.dump());
            }

            static void SaveFieldClipboard(const RE::FxDelegateArgs& params)
            {
                if (params.GetArgCount() < 2 || !params[0].IsString() || !params[1].IsString()) {
                    return;
                }
                const auto title = std::string(params[0].GetString());
                const auto body = std::string(params[1].GetString());
                if (title.size() > 512 || body.size() > 24000) {
                    return;
                }
                LocalBridge::QueueFieldAction(
                    "save_clipboard",
                    json{ { "title", title }, { "body", body } }.dump());
            }

            static void CreateFieldMark(const RE::FxDelegateArgs& params)
            {
                if (params.GetArgCount() < 2 || !params[0].IsString() || !params[1].IsString()) {
                    return;
                }
                const auto title = std::string(params[0].GetString());
                const auto notes = std::string(params[1].GetString());
                if (title.empty() || title.size() > 512 || notes.size() > 7200) {
                    return;
                }
                LocalBridge::QueueFieldAction(
                    "create_mark_at_position",
                    json{ { "title", title }, { "notes", notes }, { "category", "landmark" } }.dump());
            }

            static void OpenTravelView(const RE::FxDelegateArgs&)
            {
                Hide();
                FieldAtlasUI::OpenTravel();
            }

            static void SetMapKeyBehavior(const RE::FxDelegateArgs& params)
            {
                if (params.GetArgCount() < 1 || !params[0].IsBool()) {
                    return;
                }
                SetMapKeyOpensAtlas(params[0].GetBool());
                if (const auto current = Current()) {
                    current->last_state_key_.clear();
                    current->PushState(true);
                }
            }

            static void BeginTextEntry(const RE::FxDelegateArgs& params)
            {
                const auto current = Current();
                spdlog::info(
                    "Ranger Atlas BeginTextEntry callback received (args {}, menu {}).",
                    params.GetArgCount(),
                    current != nullptr);
                if (current) {
                    current->SetTextEntryActive(true);
                }
            }

            static void EndTextEntry(const RE::FxDelegateArgs& params)
            {
                const auto current = Current();
                spdlog::info(
                    "Ranger Atlas EndTextEntry callback received (args {}, menu {}).",
                    params.GetArgCount(),
                    current != nullptr);
                if (current) {
                    current->SetTextEntryActive(false);
                    current->last_state_key_.clear();
                    current->PushState(true);
                }
            }

            void SetTextEntryActive(bool active)
            {
                if (text_entry_active_ == active) {
                    return;
                }
                text_entry_active_ = active;
                if (active) {
                    text_input_owned_ = acquire_text_input();
                } else if (text_input_owned_) {
                    release_text_input();
                    text_input_owned_ = false;
                }
                spdlog::info(
                    "Ranger Atlas text-entry state {} (native input ownership {}).",
                    active ? "enabled" : "disabled",
                    active ? (text_input_owned_ ? "acquired" : "unavailable") : "released");
            }

        public:
            bool CancelTextEntry(bool suppress_follow_up_escape = false)
            {
                if (!text_entry_active_ && !ModalIsOpen()) {
                    return false;
                }

                if (suppress_follow_up_escape) {
                    suppress_escape_until_ = std::chrono::steady_clock::now() + kEscapeSuppressionWindow;
                }

                if (!uiMovie || !uiMovie->Invoke("_root.RangerAtlasMenu_mc.CloseModal", nullptr, nullptr, 0)) {
                    spdlog::warn("Ranger Atlas could not invoke the Scaleform modal close handler.");
                    SetTextEntryActive(false);
                }
                return true;
            }

        private:
            bool ModalIsOpen() const
            {
                if (!uiMovie) {
                    return false;
                }
                RE::GFxValue result;
                return uiMovie->Invoke("_root.RangerAtlasMenu_mc.IsModalOpen", &result, nullptr, 0) &&
                    result.IsBool() && result.GetBool();
            }

            static void ReportSurfaceStatus(const RE::FxDelegateArgs& params)
            {
                const auto tile_count = params.GetArgCount() > 0 && params[0].IsNumber()
                    ? static_cast<int>(params[0].GetNumber())
                    : -1;
                const auto width = params.GetArgCount() > 1 && params[1].IsNumber()
                    ? static_cast<int>(params[1].GetNumber())
                    : 0;
                const auto height = params.GetArgCount() > 2 && params[2].IsNumber()
                    ? static_cast<int>(params[2].GetNumber())
                    : 0;
                if (tile_count == 6) {
                    spdlog::info("Ranger Atlas illustrated surface initialized with all {} lossless tiles ({}x{}).", tile_count, width, height);
                } else {
                    spdlog::error("Ranger Atlas illustrated surface initialized with only {}/6 tiles ({}x{}).", tile_count, width, height);
                }
            }

            std::string last_state_key_;
            std::chrono::steady_clock::time_point next_refresh_{};
            std::chrono::steady_clock::time_point suppress_escape_until_{};
            bool text_entry_active_ = false;
            bool text_input_owned_ = false;
        };

        void show_now()
        {
            const auto queue = RE::UIMessageQueue::GetSingleton();
            if (!queue) {
                return;
            }
            queue->AddMessage(kMenuName, RE::UI_MESSAGE_TYPE::kShow, nullptr);
        }
    }

    void Register()
    {
        if (g_registered.load()) {
            return;
        }
        load_settings();
        const auto ui = RE::UI::GetSingleton();
        if (!ui) {
            spdlog::warn("Ranger Atlas Scaleform menu could not access the UI registry.");
            return;
        }
        ui->Register(kMenuName, Menu::Creator);
        g_registered = true;
        spdlog::info("Ranger Atlas native Scaleform map surface registered.");
    }

    bool QueueShow()
    {
        if (!g_registered.load() || !std::filesystem::exists(kMenuAssetPath)) {
            return false;
        }
        if (g_show_queued.exchange(true)) {
            return true;
        }

        const auto tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            g_show_queued = false;
            return false;
        }
        tasks->AddUITask([] {
            const auto next_tasks = SKSE::GetTaskInterface();
            if (!next_tasks) {
                g_show_queued = false;
                return;
            }
            next_tasks->AddUITask([] {
                g_show_queued = false;
                const auto ui = RE::UI::GetSingleton();
                if (!ui || !ui->IsMenuOpen(RE::MapMenu::MENU_NAME) || ui->IsMenuOpen(kMenuName)) {
                    return;
                }
                show_now();
                g_suppress_next_map_close = true;
                if (const auto queue = RE::UIMessageQueue::GetSingleton()) {
                    queue->AddMessage(RE::MapMenu::MENU_NAME, RE::UI_MESSAGE_TYPE::kHide, nullptr);
                }
            });
        });
        return true;
    }

    bool ToggleFromHotkey()
    {
        if (!g_registered.load() || !std::filesystem::exists(kMenuAssetPath)) {
            return false;
        }
        if (IsOpen()) {
            Hide();
            return true;
        }
        if (const auto ui = RE::UI::GetSingleton();
            ui && ui->IsMenuOpen(RE::MapMenu::MENU_NAME)) {
            return false;
        }
        if (g_show_queued.exchange(true)) {
            return true;
        }

        const auto tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            g_show_queued = false;
            return false;
        }
        tasks->AddUITask([] {
            g_show_queued = false;
            if (!IsOpen()) {
                show_now();
            }
        });
        return true;
    }

    bool IsOpen()
    {
        const auto ui = RE::UI::GetSingleton();
        return ui && ui->IsMenuOpen(kMenuName);
    }

    bool HandleTextEntryEscape()
    {
        const auto menu = g_active_menu.load();
        return menu && menu->CancelTextEntry(true);
    }

    bool MapKeyOpensAtlas()
    {
        return g_map_key_opens_atlas.load();
    }

    void SetMapKeyOpensAtlas(bool enabled)
    {
        if (g_map_key_opens_atlas.exchange(enabled) == enabled) {
            return;
        }
        save_settings();
    }

    bool ConsumeNativeMapRequest()
    {
        return g_native_map_requested.exchange(false);
    }

    bool ConsumeMapMenuCloseSuppression()
    {
        return g_suppress_next_map_close.exchange(false);
    }

    void Hide()
    {
        g_show_queued = false;
        if (const auto queue = RE::UIMessageQueue::GetSingleton()) {
            queue->AddMessage(kMenuName, RE::UI_MESSAGE_TYPE::kHide, nullptr);
        }
    }

    void Reset()
    {
        g_show_queued = false;
        g_native_map_requested = false;
        g_suppress_next_map_close = false;
        Hide();
    }
}
