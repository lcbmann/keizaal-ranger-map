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
        constexpr MenuFramework::Vec2 interactive_map_size{ 484.0F, 363.0F };
        constexpr MenuFramework::Vec2 travel_map_size{ 360.0F, 270.0F };
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
        std::string g_status = "Ready.";
        void* g_map_texture = nullptr;

        std::uint32_t rgba(std::uint8_t red, std::uint8_t green, std::uint8_t blue, std::uint8_t alpha = 255)
        {
            return static_cast<std::uint32_t>(red) |
                   (static_cast<std::uint32_t>(green) << 8) |
                   (static_cast<std::uint32_t>(blue) << 16) |
                   (static_cast<std::uint32_t>(alpha) << 24);
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

        void draw_player_arrow(MenuFramework::DrawList* draw_list, MenuFramework::Vec2 center, float heading)
        {
            constexpr float pi = 3.14159265358979323846F;
            const auto radians = heading * pi / 180.0F;
            const MenuFramework::Vec2 direction{ std::sin(radians), -std::cos(radians) };
            const MenuFramework::Vec2 right{ std::cos(radians), std::sin(radians) };
            const MenuFramework::Vec2 tip{ center.x + direction.x * 11.0F, center.y + direction.y * 11.0F };
            const MenuFramework::Vec2 tail{ center.x - direction.x * 7.0F, center.y - direction.y * 7.0F };
            const MenuFramework::Vec2 left{ tail.x - right.x * 6.0F, tail.y - right.y * 6.0F };
            const MenuFramework::Vec2 right_point{ tail.x + right.x * 6.0F, tail.y + right.y * 6.0F };

            MenuFramework::draw_circle(draw_list, center, 10.0F, rgba(255, 247, 205), 2.0F);
            MenuFramework::draw_triangle_filled(draw_list, tip, left, right_point, rgba(62, 166, 203));
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

            const auto radius = (std::max)(3.0F, (trailmark_radius / atlas_map_width) * display_size.x);
            for (const auto& trailmark : json_object_array(raw_state, "official_trailmarks")) {
                const MenuFramework::Vec2 point{
                    static_cast<float>(json_number(trailmark, "x", -1.0)),
                    static_cast<float>(json_number(trailmark, "y", -1.0)),
                };
                if (point.x < 0.0F || point.y < 0.0F) {
                    continue;
                }
                const auto position = map_position(origin, point, display_size);
                MenuFramework::draw_circle(draw_list, position, radius, rgba(91, 132, 77, 190), 1.0F);
                MenuFramework::draw_circle_filled(draw_list, position, 3.5F, rgba(69, 112, 68, 235));
                if (json_bool(trailmark, "within_range")) {
                    MenuFramework::draw_circle(draw_list, position, radius + 5.0F, rgba(242, 199, 78), 2.5F);
                }
            }

            const auto player_source = json_object(raw_state, "player_point");
            const MenuFramework::Vec2 player{
                static_cast<float>(json_number(player_source, "x", -1.0)),
                static_cast<float>(json_number(player_source, "y", -1.0)),
            };
            if (player.x >= 0.0F && player.y >= 0.0F) {
                draw_player_arrow(
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

        void render_trailmark(std::string_view nearest)
        {
            if (nearest.empty()) {
                MenuFramework::text("No official Trailmark is available.");
                return;
            }

            const auto title = json_string(nearest, "title", "Nearby Trailmark");
            const auto distance = json_number(nearest, "distance");
            const auto within_range = json_bool(nearest, "within_range");
            MenuFramework::text((within_range ? "TRAILMARK IN RANGE" : "NEAREST TRAILMARK"));
            MenuFramework::text(title.c_str());
            MenuFramework::text((std::to_string(static_cast<int>(std::round(distance))) +
                (within_range ? " atlas units away - in range" : " atlas units away")).c_str());

            const auto notes = json_string(nearest, "notes");
            if (!notes.empty()) {
                MenuFramework::text("Directions");
                MenuFramework::text_wrapped(notes.c_str());
            }

            if (!within_range) {
                MenuFramework::separator();
                MenuFramework::text_wrapped("Enter the highlighted Trailmark radius to view visitors or leave a field drop.");
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
                MenuFramework::text("Recent visitors");
                for (const auto& visitor : visitors) {
                    MenuFramework::text(("- " + visitor).c_str());
                }
            }

            MenuFramework::separator();
            MenuFramework::text("Leave a field drop");
            MenuFramework::input_text_multiline("##field-drop", g_drop_message.data(), g_drop_message.size(), { 484.0F, 86.0F });
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
            MenuFramework::text("Save a mark at your current outdoor position.");
            MenuFramework::text("Title");
            MenuFramework::input_text("##mark-title", g_mark_title.data(), g_mark_title.size());
            MenuFramework::text("Category");
            if (MenuFramework::begin_combo("##mark-category", mark_categories[g_mark_category].label)) {
                for (std::size_t index = 0; index < mark_categories.size(); ++index) {
                    if (MenuFramework::selectable(mark_categories[index].label, index == g_mark_category)) {
                        g_mark_category = index;
                    }
                }
                MenuFramework::end_combo();
            }
            MenuFramework::text("Notes");
            MenuFramework::input_text_multiline("##mark-notes", g_mark_notes.data(), g_mark_notes.size(), { 484.0F, 90.0F });
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
            bool open = true;
            MenuFramework::set_next_window_pos({ 34.0F, 64.0F });
            MenuFramework::set_next_window_size(travel_mode ? MenuFramework::Vec2{ 406.0F, 0.0F } : MenuFramework::Vec2{ 530.0F, 0.0F });
            if (!MenuFramework::begin("Ranger Atlas##RangerAtlasFieldConsole", &open)) {
                MenuFramework::end();
                return;
            }

            if (!open && g_window) {
                g_window->IsOpen = false;
            }

            const auto raw_state = LocalBridge::GetFieldState();
            const auto ready = json_bool(raw_state, "ready");
            const auto nearest = json_object(raw_state, "nearest_trailmark");

            if (travel_mode) {
                MenuFramework::text("RANGER ATLAS - TRAVEL VIEW");
                MenuFramework::text("F7 closes. Reopen F7 for controls.");
                MenuFramework::separator();
                if (ready) {
                    render_map(raw_state, travel_map_size);
                    if (!nearest.empty()) {
                        const auto title = json_string(nearest, "title", "Trailmark");
                        const auto distance = static_cast<int>(std::round(json_number(nearest, "distance")));
                        if (json_bool(nearest, "within_range")) {
                            MenuFramework::text(("IN RANGE - " + title).c_str());
                            MenuFramework::text("Press F7 twice to reopen the field controls.");
                        } else {
                            MenuFramework::text((title + " - " + std::to_string(distance) + " away").c_str());
                        }
                    }
                } else {
                    MenuFramework::text("Atlas link unavailable.");
                    MenuFramework::text_wrapped("Keep the browser Atlas open with Live position enabled.");
                }
                MenuFramework::end();
                return;
            }

            MenuFramework::text("RANGER ATLAS - FIELD CONSOLE");
            if (MenuFramework::button("Travel with map open", { 190.0F, 0.0F })) {
                enable_travel_mode();
            }
            MenuFramework::same_line();
            MenuFramework::text("F7 closes");
            MenuFramework::separator();

            if (!ready) {
                MenuFramework::text("Atlas link unavailable");
                MenuFramework::text_wrapped("Open the Ranger Atlas in your browser, enter your name, and enable Live position.");
                MenuFramework::end();
                return;
            }

            const auto ranger_name = json_string(raw_state, "ranger_name", "Unnamed Ranger");
            MenuFramework::text((ranger_name + " - linked to Skyrim").c_str());
            render_map(raw_state, interactive_map_size);
            MenuFramework::text("Blue arrow: you   Green: Trailmark   Gold ring: in range");
            MenuFramework::separator();

            if (MenuFramework::begin_tab_bar("##field-console-tabs")) {
                if (MenuFramework::begin_tab_item("Field")) {
                    render_trailmark(nearest);
                    MenuFramework::end_tab_item();
                }
                if (MenuFramework::begin_tab_item("Mark current position")) {
                    render_mark_form();
                    MenuFramework::end_tab_item();
                }
                MenuFramework::end_tab_bar();
            }

            MenuFramework::separator();
            MenuFramework::text_wrapped(g_status.c_str());
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
