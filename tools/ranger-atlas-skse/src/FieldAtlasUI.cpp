#include "PCH.h"

#include "FieldAtlasUI.h"
#include "LocalBridge.h"
#include "MenuFrameworkApi.h"

namespace RangerAtlas::FieldAtlasUI
{
    namespace
    {
        struct MarkCategory
        {
            const char* id;
            const char* label;
        };

        struct TravelSizeOption
        {
            const char* label;
            MenuFramework::Vec2 map_size;
        };

        constexpr std::array mark_categories{
            MarkCategory{ "landmark", "Landmark" },
            MarkCategory{ "cache", "Cache" },
            MarkCategory{ "contact", "Contact" },
            MarkCategory{ "threat", "Threat" },
            MarkCategory{ "camp", "Camp" },
            MarkCategory{ "hunting", "Hunting Spot" },
            MarkCategory{ "ore", "Ore Vein" },
            MarkCategory{ "ingredient", "Ingredient" },
            MarkCategory{ "post", "Guild Post" },
            MarkCategory{ "trailmark", "Trailmark" },
            MarkCategory{ "station", "Station" },
        };

        constexpr float atlas_map_width = 8192.0F;
        constexpr float atlas_map_height = 6144.0F;
        constexpr float trailmark_radius = 96.0F;
        constexpr float atlas_units_to_meters = 0.79F;
        constexpr MenuFramework::Vec2 interactive_map_size{ 640.0F, 480.0F };
        constexpr std::array travel_sizes{
            TravelSizeOption{ "Compact", { 360.0F, 270.0F } },
            TravelSizeOption{ "Standard", { 480.0F, 360.0F } },
            TravelSizeOption{ "Large", { 640.0F, 480.0F } },
        };
        constexpr std::uint32_t field_menu_key = 0x41;

        MenuFramework::Window* g_window = nullptr;
        std::atomic_bool g_initialized = false;
        std::atomic_bool g_owns_input = false;
        std::atomic_bool g_travel_mode = false;
        std::array<char, 121> g_mark_title = [] {
            std::array<char, 121> value{};
            std::copy_n("Field note", 11, value.begin());
            return value;
        }();
        std::array<char, 801> g_mark_notes{};
        std::array<char, 1801> g_drop_message{};
        std::size_t g_mark_category = 0;
        std::size_t g_travel_size = 0;
        std::string g_status = "Ready.";
        void* g_map_texture = nullptr;

        std::uint32_t rgba(std::uint8_t red, std::uint8_t green, std::uint8_t blue, std::uint8_t alpha = 255)
        {
            return static_cast<std::uint32_t>(red) |
                   (static_cast<std::uint32_t>(green) << 8) |
                   (static_cast<std::uint32_t>(blue) << 16) |
                   (static_cast<std::uint32_t>(alpha) << 24);
        }

        void accent_text(const char* value)
        {
            MenuFramework::text(value);
        }

        void muted_text(const char* value)
        {
            MenuFramework::text_wrapped(value);
        }

        std::string json_escape(std::string_view value)
        {
            std::string escaped;
            escaped.reserve(value.size());
            for (const auto character : value) {
                switch (character) {
                case '\\': escaped += "\\\\"; break;
                case '"': escaped += "\\\""; break;
                case '\n': escaped += "\\n"; break;
                case '\r': break;
                case '\t': escaped += "\\t"; break;
                default: escaped += character; break;
                }
            }
            return escaped;
        }

        std::string json_string(std::string_view source, std::string_view key, std::string fallback = {})
        {
            const auto prefix = "\"" + std::string(key) + "\":\"";
            const auto start = source.find(prefix);
            if (start == std::string_view::npos) {
                return fallback;
            }
            std::string value;
            for (std::size_t index = start + prefix.size(); index < source.size(); ++index) {
                const auto character = source[index];
                if (character == '"') {
                    return value;
                }
                if (character == '\\' && index + 1 < source.size()) {
                    const auto escaped = source[++index];
                    value += escaped == 'n' ? '\n' : escaped == 't' ? '\t' : escaped;
                } else {
                    value += character;
                }
            }
            return fallback;
        }

        bool json_bool(std::string_view source, std::string_view key, bool fallback = false)
        {
            const auto prefix = "\"" + std::string(key) + "\":";
            const auto start = source.find(prefix);
            if (start == std::string_view::npos) {
                return fallback;
            }
            const auto value = source.substr(start + prefix.size());
            return value.starts_with("true") ? true : value.starts_with("false") ? false : fallback;
        }

        double json_number(std::string_view source, std::string_view key, double fallback = 0.0)
        {
            const auto prefix = "\"" + std::string(key) + "\":";
            const auto start = source.find(prefix);
            if (start == std::string_view::npos) {
                return fallback;
            }
            const auto value_start = start + prefix.size();
            const auto value_end = source.find_first_of(",}", value_start);
            try {
                return std::stod(std::string(source.substr(value_start, value_end - value_start)));
            } catch (const std::exception&) {
                return fallback;
            }
        }

        std::string json_object(std::string_view source, std::string_view key)
        {
            const auto prefix = "\"" + std::string(key) + "\":{";
            const auto start = source.find(prefix);
            if (start == std::string_view::npos) {
                return {};
            }
            int depth = 0;
            bool in_string = false;
            bool escaped = false;
            for (std::size_t index = start + prefix.size() - 1; index < source.size(); ++index) {
                const auto character = source[index];
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (character == '\\' && in_string) {
                    escaped = true;
                    continue;
                }
                if (character == '"') {
                    in_string = !in_string;
                    continue;
                }
                if (in_string) {
                    continue;
                }
                if (character == '{') {
                    ++depth;
                } else if (character == '}' && --depth == 0) {
                    return std::string(source.substr(start + prefix.size() - 1, index - start - prefix.size() + 2));
                }
            }
            return {};
        }

        std::vector<std::string> json_object_array(std::string_view source, std::string_view key)
        {
            std::vector<std::string> values;
            const auto prefix = "\"" + std::string(key) + "\":[";
            const auto start = source.find(prefix);
            if (start == std::string_view::npos) {
                return values;
            }

            int depth = 0;
            bool in_string = false;
            bool escaped = false;
            std::size_t object_start = std::string_view::npos;
            for (std::size_t index = start + prefix.size(); index < source.size(); ++index) {
                const auto character = source[index];
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (character == '\\' && in_string) {
                    escaped = true;
                    continue;
                }
                if (character == '"') {
                    in_string = !in_string;
                    continue;
                }
                if (in_string) {
                    continue;
                }
                if (character == '{') {
                    if (depth++ == 0) {
                        object_start = index;
                    }
                } else if (character == '}' && --depth == 0 && object_start != std::string_view::npos) {
                    values.emplace_back(source.substr(object_start, index - object_start + 1));
                    object_start = std::string_view::npos;
                } else if (character == ']' && depth == 0) {
                    break;
                }
            }
            return values;
        }

        std::vector<std::string> json_string_array(std::string_view source, std::string_view key)
        {
            std::vector<std::string> values;
            const auto prefix = "\"" + std::string(key) + "\":[";
            const auto start = source.find(prefix);
            if (start == std::string_view::npos) {
                return values;
            }
            auto index = start + prefix.size();
            while (index < source.size() && source[index] != ']') {
                if (source[index] == '"') {
                    std::string value;
                    bool escaped = false;
                    for (++index; index < source.size(); ++index) {
                        const auto character = source[index];
                        if (escaped) {
                            value += character == 'n' ? '\n' : character;
                            escaped = false;
                        } else if (character == '\\') {
                            escaped = true;
                        } else if (character == '"') {
                            ++index;
                            break;
                        } else {
                            value += character;
                        }
                    }
                    values.push_back(std::move(value));
                } else {
                    ++index;
                }
            }
            return values;
        }

        MenuFramework::Vec2 map_position(MenuFramework::Vec2 origin, MenuFramework::Vec2 atlas_point, MenuFramework::Vec2 display_size)
        {
            return {
                origin.x + (atlas_point.x / atlas_map_width) * display_size.x,
                origin.y + ((atlas_map_height - atlas_point.y) / atlas_map_height) * display_size.y,
            };
        }

        void draw_player_marker(MenuFramework::DrawList* draw_list, MenuFramework::Vec2 center, float heading)
        {
            constexpr float pi = 3.14159265358979323846F;
            const auto radians = heading * pi / 180.0F;
            const MenuFramework::Vec2 direction{ std::sin(radians), -std::cos(radians) };
            const MenuFramework::Vec2 right{ std::cos(radians), std::sin(radians) };
            const MenuFramework::Vec2 outer_tip{ center.x + direction.x * 15.0F, center.y + direction.y * 15.0F };
            const MenuFramework::Vec2 outer_tail{ center.x - direction.x * 8.0F, center.y - direction.y * 8.0F };
            const MenuFramework::Vec2 outer_left{ outer_tail.x - right.x * 8.0F, outer_tail.y - right.y * 8.0F };
            const MenuFramework::Vec2 outer_right{ outer_tail.x + right.x * 8.0F, outer_tail.y + right.y * 8.0F };
            const MenuFramework::Vec2 inner_tip{ center.x + direction.x * 12.0F, center.y + direction.y * 12.0F };
            const MenuFramework::Vec2 inner_tail{ center.x - direction.x * 5.0F, center.y - direction.y * 5.0F };
            const MenuFramework::Vec2 inner_left{ inner_tail.x - right.x * 5.0F, inner_tail.y - right.y * 5.0F };
            const MenuFramework::Vec2 inner_right{ inner_tail.x + right.x * 5.0F, inner_tail.y + right.y * 5.0F };

            MenuFramework::draw_circle_filled(draw_list, center, 12.0F, rgba(24, 31, 27, 235));
            MenuFramework::draw_circle(draw_list, center, 12.0F, rgba(231, 208, 142), 2.0F);
            MenuFramework::draw_triangle_filled(draw_list, outer_tip, outer_left, outer_right, rgba(24, 31, 27, 255));
            MenuFramework::draw_triangle_filled(draw_list, inner_tip, inner_left, inner_right, rgba(73, 170, 191, 255));
            MenuFramework::draw_circle_filled(draw_list, center, 2.6F, rgba(240, 226, 181, 255));
        }

        std::string compass_direction(MenuFramework::Vec2 from, MenuFramework::Vec2 to, bool abbreviated)
        {
            constexpr float pi = 3.14159265358979323846F;
            constexpr std::array short_names{ "N", "NE", "E", "SE", "S", "SW", "W", "NW" };
            constexpr std::array long_names{
                "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"
            };
            // Atlas Y increases southward, so invert its delta for compass bearings.
            auto degrees = std::atan2(to.x - from.x, from.y - to.y) * 180.0F / pi;
            if (degrees < 0.0F) {
                degrees += 360.0F;
            }
            const auto index = static_cast<std::size_t>(std::lround(degrees / 45.0F)) % short_names.size();
            return abbreviated ? short_names[index] : long_names[index];
        }

        std::string navigation_readout(std::string_view raw_state, std::string_view nearest, bool abbreviated)
        {
            const auto distance = static_cast<float>(json_number(nearest, "distance", -1.0));
            if (distance < 0.0F) {
                return {};
            }
            const auto meters = (std::max)(5, static_cast<int>(std::lround(distance * atlas_units_to_meters / 5.0F) * 5));
            std::string readout = std::to_string(meters) + " m";

            const auto player_source = json_object(raw_state, "player_point");
            const auto point_source = json_object(nearest, "point");
            const MenuFramework::Vec2 player{
                static_cast<float>(json_number(player_source, "x", -1.0)),
                static_cast<float>(json_number(player_source, "y", -1.0)),
            };
            const MenuFramework::Vec2 point{
                static_cast<float>(json_number(point_source, "x", -1.0)),
                static_cast<float>(json_number(point_source, "y", -1.0)),
            };
            if (player.x >= 0.0F && player.y >= 0.0F && point.x >= 0.0F && point.y >= 0.0F) {
                readout += abbreviated ? " " : " to the ";
                readout += compass_direction(player, point, abbreviated);
            }
            return readout;
        }

        std::uint32_t marker_color(std::string_view category)
        {
            if (category == "threat") {
                return rgba(166, 69, 55, 225);
            }
            if (category == "cache") {
                return rgba(177, 125, 51, 225);
            }
            if (category == "contact") {
                return rgba(70, 132, 143, 225);
            }
            if (category == "camp" || category == "hunting" || category == "ingredient") {
                return rgba(104, 137, 73, 225);
            }
            if (category == "ore") {
                return rgba(133, 137, 141, 225);
            }
            if (category == "post" || category == "station") {
                return rgba(75, 123, 96, 225);
            }
            return rgba(180, 157, 105, 215);
        }

        void render_map(std::string_view raw_state, MenuFramework::Vec2 display_size)
        {
            if (!g_map_texture) {
                g_map_texture = MenuFramework::load_texture("Data/SKSE/Plugins/RangerAtlas/field-map.jpg", { 1024.0F, 768.0F });
            }
            if (!g_map_texture) {
                MenuFramework::text("Map image unavailable. Reinstall the Ranger Atlas package.");
                return;
            }

            const auto origin = MenuFramework::cursor_screen_pos();
            MenuFramework::image(g_map_texture, display_size);
            const auto draw_list = MenuFramework::window_draw_list();
            if (!draw_list) {
                return;
            }

            const auto player_source = json_object(raw_state, "player_point");
            const MenuFramework::Vec2 player{
                static_cast<float>(json_number(player_source, "x", -1.0)),
                static_cast<float>(json_number(player_source, "y", -1.0)),
            };

            // Personal and non-Trailmark Guild marks are intentionally understated.
            for (const auto& marker : json_object_array(raw_state, "map_markers")) {
                const MenuFramework::Vec2 point{
                    static_cast<float>(json_number(marker, "x", -1.0)),
                    static_cast<float>(json_number(marker, "y", -1.0)),
                };
                if (point.x < 0.0F || point.y < 0.0F) {
                    continue;
                }
                const auto position = map_position(origin, point, display_size);
                MenuFramework::draw_circle_filled(draw_list, position, 2.5F, rgba(28, 27, 21, 220));
                MenuFramework::draw_circle_filled(
                    draw_list,
                    position,
                    1.6F,
                    marker_color(json_string(marker, "category", "landmark")));
            }

            // The dedicated marker snapshot is the authoritative native sync. Fall back to
            // field-state data so older browser builds still show their available Trailmarks.
            auto trailmarks = json_object_array(LocalBridge::GetNativeMarkerSnapshot(), "markers");
            if (trailmarks.empty()) {
                trailmarks = json_object_array(raw_state, "official_trailmarks");
            }
            if (trailmarks.empty()) {
                trailmarks = json_object_array(raw_state, "nearby_trailmarks");
            }
            if (trailmarks.empty()) {
                const auto nearest = json_object(raw_state, "nearest_trailmark");
                const auto nearest_point = json_object(nearest, "point");
                if (!nearest_point.empty()) {
                    trailmarks.push_back(nearest_point);
                }
            }

            const auto radius = (std::max)(4.0F, (trailmark_radius / atlas_map_width) * display_size.x);
            for (const auto& trailmark : trailmarks) {
                const MenuFramework::Vec2 point{
                    static_cast<float>(json_number(trailmark, "x", -1.0)),
                    static_cast<float>(json_number(trailmark, "y", -1.0)),
                };
                if (point.x < 0.0F || point.y < 0.0F) {
                    continue;
                }
                const auto position = map_position(origin, point, display_size);
                MenuFramework::draw_circle(draw_list, position, radius, rgba(99, 145, 81, 150), 1.0F);
                MenuFramework::draw_circle_filled(draw_list, position, 6.0F, rgba(25, 31, 23, 235));
                MenuFramework::draw_circle_filled(draw_list, position, 4.3F, rgba(76, 132, 73, 255));
                MenuFramework::draw_circle_filled(draw_list, position, 1.4F, rgba(232, 210, 148, 255));

                const auto calculated_in_range = player.x >= 0.0F && player.y >= 0.0F &&
                    std::hypot(point.x - player.x, point.y - player.y) <= trailmark_radius;
                if (calculated_in_range || json_bool(trailmark, "within_range")) {
                    MenuFramework::draw_circle(draw_list, position, radius + 6.0F, rgba(242, 199, 78), 2.5F);
                }
            }

            if (player.x >= 0.0F && player.y >= 0.0F) {
                draw_player_marker(
                    draw_list,
                    map_position(origin, player, display_size),
                    static_cast<float>(json_number(player_source, "heading", 0.0)));
            }
        }

        void queue_action(std::string_view type, std::string payload = "{}")
        {
            LocalBridge::QueueFieldAction(std::string(type), std::move(payload));
            g_status = "Sent to the Ranger Atlas.";
        }

        void render_trailmark(std::string_view raw_state, std::string_view nearest)
        {
            if (nearest.empty()) {
                muted_text("No official Trailmark is available.");
                return;
            }

            const auto title = json_string(nearest, "title", "Nearby Trailmark");
            const auto within_range = json_bool(nearest, "within_range");
            accent_text(within_range ? "TRAILMARK IN RANGE" : "NEAREST TRAILMARK");
            MenuFramework::text(title.c_str());
            const auto navigation = navigation_readout(raw_state, nearest, false);
            muted_text((navigation + (within_range ? " - within reach" : "")).c_str());

            const auto notes = json_string(nearest, "notes");
            if (!notes.empty()) {
                MenuFramework::spacing();
                accent_text("DIRECTIONS");
                muted_text(notes.c_str());
            }

            if (!within_range) {
                MenuFramework::separator();
                muted_text("Enter the highlighted Trailmark radius to view visitors or leave a field drop.");
                return;
            }

            if (MenuFramework::button("Refresh visitors")) {
                queue_action("refresh_nearby_trailmark_visits");
            }
            MenuFramework::same_line();
            if (MenuFramework::button("Record visit")) {
                queue_action("record_nearby_trailmark_visit");
            }

            const auto visitors = json_string_array(nearest, "recent_visitor_lines");
            if (!visitors.empty()) {
                accent_text("RECENT VISITORS");
                for (const auto& visitor : visitors) {
                    muted_text(("- " + visitor).c_str());
                }
            }

            MenuFramework::separator();
            accent_text("LEAVE A FIELD DROP");
            MenuFramework::input_text_multiline("##field-drop", g_drop_message.data(), g_drop_message.size(), { 640.0F, 86.0F });
            if (MenuFramework::button("Send field drop", { 180.0F, 0.0F })) {
                const std::string message(g_drop_message.data());
                if (message.empty()) {
                    g_status = "Write a field drop before sending it.";
                } else {
                    queue_action("submit_nearby_trailmark_drop", "{\"message\":\"" + json_escape(message) + "\"}");
                    g_drop_message.fill('\0');
                }
            }
        }

        void render_mark_form()
        {
            muted_text("Save a mark directly at your current outdoor position.");
            accent_text("TITLE");
            MenuFramework::input_text("##mark-title", g_mark_title.data(), g_mark_title.size());
            accent_text("CATEGORY");
            if (MenuFramework::begin_combo("##mark-category", mark_categories[g_mark_category].label)) {
                for (std::size_t index = 0; index < mark_categories.size(); ++index) {
                    if (MenuFramework::selectable(mark_categories[index].label, index == g_mark_category)) {
                        g_mark_category = index;
                    }
                }
                MenuFramework::end_combo();
            }
            accent_text("NOTES");
            MenuFramework::input_text_multiline("##mark-notes", g_mark_notes.data(), g_mark_notes.size(), { 640.0F, 90.0F });
            if (MenuFramework::button("Save mark to Atlas", { 180.0F, 0.0F })) {
                const std::string title(g_mark_title.data());
                if (title.empty()) {
                    g_status = "Give the field mark a title first.";
                    return;
                }
                queue_action(
                    "create_mark_at_position",
                    "{\"title\":\"" + json_escape(title) +
                        "\",\"notes\":\"" + json_escape(g_mark_notes.data()) +
                        "\",\"category\":\"" + mark_categories[g_mark_category].id + "\"}");
                g_mark_notes.fill('\0');
                g_status = "Field mark sent and saved to this Atlas copy.";
            }
        }

        void enable_travel_mode()
        {
            g_travel_mode = true;
            if (g_window) {
                g_window->BlockUserInput = false;
            }
            g_status = "Travel view active. Press F7 to close it.";
        }

        void keep_world_running()
        {
            if (const auto main = RE::Main::GetSingleton()) {
                main->freezeTime = false;
            }
        }

        bool __stdcall handle_menu_input(RE::InputEvent* event)
        {
            const auto button = event ? event->AsButtonEvent() : nullptr;
            if (!button || button->GetDevice() != RE::INPUT_DEVICE::kKeyboard ||
                button->GetIDCode() != field_menu_key || !button->IsDown()) {
                return false;
            }
            Toggle();
            return true;
        }

        void __stdcall render_window()
        {
            const auto travel_mode = g_travel_mode.load();
            const auto travel_map_size = travel_sizes[g_travel_size].map_size;
            bool open = true;
            MenuFramework::set_next_window_pos({ 34.0F, 64.0F });
            MenuFramework::set_next_window_size(
                travel_mode ? MenuFramework::Vec2{ travel_map_size.x + 46.0F, 0.0F } : MenuFramework::Vec2{ 686.0F, 0.0F });

            // Retain Menu Framework cursor capture without freezing the multiplayer world.
            if (!travel_mode) {
                keep_world_running();
            }
            if (!MenuFramework::begin("Ranger Atlas##RangerAtlasFieldConsole", &open)) {
                MenuFramework::end();
                return;
            }

            if (!travel_mode) {
                keep_world_running();
            }

            if (!open && g_window) {
                g_window->IsOpen = false;
            }

            const auto raw_state = LocalBridge::GetFieldState();
            const auto ready = json_bool(raw_state, "ready");
            const auto nearest = json_object(raw_state, "nearest_trailmark");

            if (travel_mode) {
                accent_text("RANGER ATLAS - TRAVEL VIEW");
                muted_text("F7 closes. Reopen F7 for controls.");
                MenuFramework::separator();
                if (ready) {
                    render_map(raw_state, travel_map_size);
                    if (!nearest.empty()) {
                        const auto title = json_string(nearest, "title", "Trailmark");
                        const auto navigation = navigation_readout(raw_state, nearest, true);
                        if (json_bool(nearest, "within_range")) {
                            accent_text(("IN RANGE - " + title + " | " + navigation).c_str());
                            muted_text("Press F7 twice to reopen the field controls.");
                        } else {
                            muted_text((title + " | " + navigation).c_str());
                        }
                    }
                } else {
                    MenuFramework::text("Atlas link unavailable.");
                    MenuFramework::text_wrapped("Keep the browser Atlas open with Live position enabled.");
                }
                MenuFramework::end();
                return;
            }

            accent_text("RANGER ATLAS - FIELD CONSOLE");
            if (MenuFramework::button("Travel view", { 150.0F, 0.0F })) {
                enable_travel_mode();
            }
            MenuFramework::same_line();
            muted_text("Keep this map open while travelling");
            MenuFramework::separator();

            if (!ready) {
                MenuFramework::text("Atlas link unavailable");
                MenuFramework::text_wrapped("Open the Ranger Atlas in your browser, enter your name, and enable Live position.");
                MenuFramework::end();
                return;
            }

            const auto ranger_name = json_string(raw_state, "ranger_name", "Unnamed Ranger");
            muted_text((ranger_name + " - linked to Skyrim").c_str());
            render_map(raw_state, interactive_map_size);
            if (!nearest.empty()) {
                const auto title = json_string(nearest, "title", "Trailmark");
                muted_text(("Nearest: " + title + " | " + navigation_readout(raw_state, nearest, true)).c_str());
            }

            accent_text("TRAVEL MAP SIZE");
            if (MenuFramework::begin_combo("##travel-map-size", travel_sizes[g_travel_size].label)) {
                for (std::size_t index = 0; index < travel_sizes.size(); ++index) {
                    if (MenuFramework::selectable(travel_sizes[index].label, index == g_travel_size)) {
                        g_travel_size = index;
                    }
                }
                MenuFramework::end_combo();
            }
            MenuFramework::separator();

            if (MenuFramework::begin_tab_bar("##field-console-tabs")) {
                if (MenuFramework::begin_tab_item("Field")) {
                    render_trailmark(raw_state, nearest);
                    MenuFramework::end_tab_item();
                }
                if (MenuFramework::begin_tab_item("Mark current position")) {
                    render_mark_form();
                    MenuFramework::end_tab_item();
                }
                MenuFramework::end_tab_bar();
            }

            MenuFramework::separator();
            muted_text(g_status.c_str());
            if (MenuFramework::button("Close")) {
                if (g_window) {
                    g_window->IsOpen = false;
                }
            }
            MenuFramework::end();
        }
    }

    void Initialize()
    {
        if (g_initialized.load()) {
            return;
        }
        if (!MenuFramework::is_available()) {
            spdlog::info("Ranger Atlas Field Console is waiting for the optional SKSE Menu Framework runtime.");
            return;
        }

        g_window = MenuFramework::add_window(render_window);
        if (!g_window) {
            spdlog::warn("Ranger Atlas could not create the Field Console window.");
            return;
        }

        g_window->BlockUserInput = true;
        g_owns_input = MenuFramework::register_input_event(handle_menu_input);
        g_initialized = true;
        spdlog::info(
            "Ranger Atlas Field Console registered with SKSE Menu Framework; framework input capture={}",
            g_owns_input.load());
    }

    void Toggle()
    {
        Initialize();
        if (!g_window) {
            RE::DebugNotification("Ranger Atlas needs SKSE Menu Framework for the Field Console.");
            return;
        }

        if (g_window->IsOpen.load()) {
            g_window->IsOpen = false;
            return;
        }

        g_travel_mode = false;
        g_window->BlockUserInput = true;
        g_window->IsOpen = true;
    }

    void Close()
    {
        if (g_window) {
            g_window->IsOpen = false;
        }
    }

    bool OwnsInput()
    {
        return g_owns_input.load();
    }
}
