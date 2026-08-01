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
        constexpr MenuFramework::Vec2 interactive_map_size{ 600.0F, 450.0F };
        constexpr MenuFramework::Vec2 field_console_size{ 646.0F, 900.0F };
        constexpr float field_content_width = 590.0F;
        constexpr std::size_t recent_visitor_preview_limit = 3;
        constexpr std::array travel_sizes{
            TravelSizeOption{ "Compact", { 400.0F, 300.0F } },
            TravelSizeOption{ "Standard", { 520.0F, 390.0F } },
            TravelSizeOption{ "Large", { 680.0F, 510.0F } },
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
        std::array<char, 121> g_clipboard_title = [] {
            std::array<char, 121> value{};
            std::copy_n("Field notes", 11, value.begin());
            return value;
        }();
        std::array<char, 6001> g_clipboard_body{};
        std::size_t g_mark_category = 0;
        std::size_t g_travel_size = 1;
        std::string g_status = "Ready.";
        void* g_map_texture = nullptr;
        MenuFramework::Vec2 g_displayed_player{ -1.0F, -1.0F };
        float g_displayed_heading = 0.0F;
        std::chrono::steady_clock::time_point g_last_player_render{};
        std::chrono::steady_clock::time_point g_clipboard_last_edit{};
        std::string g_clipboard_revision;
        std::string g_clipboard_last_queued;
        bool g_clipboard_dirty = false;
        std::unordered_map<std::string, void*> g_badge_textures;

        std::uint32_t rgba(std::uint8_t red, std::uint8_t green, std::uint8_t blue, std::uint8_t alpha = 255)
        {
            return static_cast<std::uint32_t>(red) |
                   (static_cast<std::uint32_t>(green) << 8) |
                   (static_cast<std::uint32_t>(blue) << 16) |
                   (static_cast<std::uint32_t>(alpha) << 24);
        }

        void accent_text(const char* value)
        {
            MenuFramework::text_colored({ 0.86F, 0.69F, 0.31F, 1.0F }, value);
        }

        void success_text(const char* value)
        {
            MenuFramework::text_colored({ 0.50F, 0.78F, 0.48F, 1.0F }, value);
        }

        void warning_text(const char* value)
        {
            MenuFramework::text_colored({ 0.93F, 0.72F, 0.28F, 1.0F }, value);
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

        template <std::size_t Size>
        void copy_to_buffer(std::array<char, Size>& target, std::string_view source)
        {
            target.fill('\0');
            const auto count = (std::min)(source.size(), Size - 1);
            std::copy_n(source.begin(), count, target.begin());
        }

        std::string clipboard_content_key()
        {
            return std::string(g_clipboard_title.data()) + "\n" + g_clipboard_body.data();
        }

        void sync_clipboard_from_state(std::string_view raw_state)
        {
            const auto clipboard = json_object(raw_state, "clipboard");
            if (clipboard.empty()) {
                return;
            }
            const auto title = json_string(clipboard, "title", "Field notes");
            const auto body = json_string(clipboard, "body");
            const auto revision = json_string(clipboard, "updated_at");
            const auto incoming_key = title + "\n" + body;

            if (g_clipboard_dirty) {
                if (incoming_key == clipboard_content_key() && revision != g_clipboard_revision) {
                    g_clipboard_dirty = false;
                    g_clipboard_revision = revision;
                    g_clipboard_last_queued = incoming_key;
                }
                return;
            }
            if (revision == g_clipboard_revision && !g_clipboard_revision.empty()) {
                return;
            }

            copy_to_buffer(g_clipboard_title, title);
            copy_to_buffer(g_clipboard_body, body);
            g_clipboard_revision = revision;
            g_clipboard_last_queued = incoming_key;
        }

        void* badge_texture(std::string_view badge_id)
        {
            if (badge_id.empty()) {
                return nullptr;
            }
            auto key = std::string(badge_id);
            constexpr std::string_view legacy_medal_prefix = "medal-the-";
            if (key.starts_with(legacy_medal_prefix)) {
                key = "medal-" + key.substr(legacy_medal_prefix.size());
            }
            if (const auto existing = g_badge_textures.find(key); existing != g_badge_textures.end()) {
                return existing->second;
            }
            const auto path = "Data/SKSE/Plugins/RangerAtlas/badges/" + key + ".png";
            const auto texture = MenuFramework::load_texture(path.c_str(), { 128.0F, 128.0F });
            g_badge_textures.emplace(key, texture);
            return texture;
        }

        void render_ranger_profile(std::string_view raw_state, bool compact)
        {
            const auto profile = json_object(raw_state, "ranger_profile");
            const auto primary = json_object(profile, "primary_badge");
            const auto ranger_name = json_string(raw_state, "ranger_name", "Unnamed Ranger");
            const auto rank_label = json_string(primary, "label");
            success_text((ranger_name + (rank_label.empty() ? "  |  LIVE" : "  |  " + rank_label)).c_str());

            std::vector<std::string> badge_ids;
            const auto primary_id = json_string(primary, "id");
            if (!primary_id.empty()) {
                badge_ids.push_back(primary_id);
            }
            const auto medals = json_object_array(profile, "medals");
            for (const auto& medal : medals) {
                const auto medal_id = json_string(medal, "id");
                if (!medal_id.empty() && std::find(badge_ids.begin(), badge_ids.end(), medal_id) == badge_ids.end()) {
                    badge_ids.push_back(medal_id);
                }
            }

            const auto badge_size = compact ? 24.0F : 30.0F;
            const auto badges_per_row = compact ? 12U : 16U;
            bool drew_badge = false;
            std::size_t badges_on_row = 0;
            for (const auto& badge_id : badge_ids) {
                if (const auto texture = badge_texture(badge_id)) {
                    if (drew_badge && badges_on_row < badges_per_row) {
                        MenuFramework::same_line();
                    } else if (badges_on_row >= badges_per_row) {
                        badges_on_row = 0;
                    }
                    MenuFramework::image(texture, { badge_size, badge_size });
                    drew_badge = true;
                    badges_on_row += 1;
                }
            }
        }

        void render_awake_ranger_count(std::string_view raw_state)
        {
            const auto count = static_cast<int>(json_number(raw_state, "awake_ranger_count", -1.0));
            if (count < 0) {
                return;
            }
            if (count == 0) {
                muted_text("No other Rangers awake");
                return;
            }
            const auto label = std::to_string(count) + " other " +
                (count == 1 ? "Ranger" : "Rangers") + " awake";
            muted_text(label.c_str());
        }

        MenuFramework::Vec2 map_position(MenuFramework::Vec2 origin, MenuFramework::Vec2 atlas_point, MenuFramework::Vec2 display_size)
        {
            return {
                origin.x + (atlas_point.x / atlas_map_width) * display_size.x,
                origin.y + ((atlas_map_height - atlas_point.y) / atlas_map_height) * display_size.y,
            };
        }

        void draw_player_marker(
            MenuFramework::DrawList* draw_list,
            MenuFramework::Vec2 center,
            float heading,
            float scale)
        {
            constexpr float pi = 3.14159265358979323846F;
            const auto radians = heading * pi / 180.0F;
            const MenuFramework::Vec2 direction{ std::sin(radians), -std::cos(radians) };
            const MenuFramework::Vec2 right{ std::cos(radians), std::sin(radians) };
            const auto point = [&](float forward, float sideways) {
                return MenuFramework::Vec2{
                    center.x + (direction.x * forward + right.x * sideways) * scale,
                    center.y + (direction.y * forward + right.y * sideways) * scale,
                };
            };
            const auto outer_tip = point(22.0F, 0.0F);
            const auto outer_right = point(-13.0F, 12.0F);
            const auto outer_notch = point(-5.0F, 1.5F);
            const auto outer_left = point(-10.0F, -15.0F);
            const auto inner_tip = point(18.0F, 0.0F);
            const auto inner_right = point(-9.0F, 8.5F);
            const auto inner_notch = point(-3.5F, 1.0F);
            const auto inner_left = point(-7.0F, -10.8F);

            MenuFramework::draw_circle_filled(draw_list, center, 14.0F * scale, rgba(192, 247, 244, 56));
            MenuFramework::draw_triangle_filled(draw_list, outer_tip, outer_right, outer_notch, rgba(19, 38, 42, 255));
            MenuFramework::draw_triangle_filled(draw_list, outer_tip, outer_notch, outer_left, rgba(19, 38, 42, 255));
            MenuFramework::draw_triangle_filled(draw_list, inner_tip, inner_right, inner_notch, rgba(85, 217, 223, 255));
            MenuFramework::draw_triangle_filled(draw_list, inner_tip, inner_notch, inner_left, rgba(85, 217, 223, 255));
        }

        MenuFramework::Vec2 smooth_player_position(MenuFramework::Vec2 target, float target_heading)
        {
            const auto now = std::chrono::steady_clock::now();
            const auto elapsed = std::chrono::duration<float>(now - g_last_player_render).count();
            g_last_player_render = now;

            const auto needs_snap = g_displayed_player.x < 0.0F || g_displayed_player.y < 0.0F ||
                elapsed <= 0.0F || elapsed > 0.75F ||
                std::hypot(target.x - g_displayed_player.x, target.y - g_displayed_player.y) > 500.0F;
            if (needs_snap) {
                g_displayed_player = target;
                g_displayed_heading = target_heading;
                return g_displayed_player;
            }

            const auto blend = 1.0F - std::exp(-12.0F * elapsed);
            g_displayed_player.x += (target.x - g_displayed_player.x) * blend;
            g_displayed_player.y += (target.y - g_displayed_player.y) * blend;
            const auto heading_delta = std::remainder(target_heading - g_displayed_heading, 360.0F);
            g_displayed_heading += heading_delta * blend;
            return g_displayed_player;
        }

        MenuFramework::Vec2 marker_point(std::string_view marker);

        std::string compass_direction(MenuFramework::Vec2 from, MenuFramework::Vec2 to, bool abbreviated)
        {
            constexpr float pi = 3.14159265358979323846F;
            constexpr std::array short_names{ "N", "NE", "E", "SE", "S", "SW", "W", "NW" };
            constexpr std::array long_names{
                "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"
            };
            // Atlas Y increases northward, matching the map's upward screen direction.
            auto degrees = std::atan2(to.x - from.x, to.y - from.y) * 180.0F / pi;
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

        std::string marker_navigation_readout(
            std::string_view raw_state,
            std::string_view marker,
            bool abbreviated)
        {
            const auto player_source = json_object(raw_state, "player_point");
            const MenuFramework::Vec2 player{
                static_cast<float>(json_number(player_source, "x", -1.0)),
                static_cast<float>(json_number(player_source, "y", -1.0)),
            };
            const auto point = marker_point(marker);
            if (player.x < 0.0F || player.y < 0.0F || point.x < 0.0F || point.y < 0.0F) {
                return {};
            }

            const auto atlas_distance = static_cast<float>(json_number(
                marker,
                "distance",
                std::hypot(point.x - player.x, point.y - player.y)));
            const auto meters = (std::max)(5, static_cast<int>(std::lround(atlas_distance * atlas_units_to_meters / 5.0F) * 5));
            return std::to_string(meters) + " m " + compass_direction(player, point, abbreviated);
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

        std::vector<std::string> trailmark_snapshot(std::string_view raw_state)
        {
            auto trailmarks = json_object_array(raw_state, "official_trailmarks");
            if (trailmarks.empty()) {
                trailmarks = json_object_array(LocalBridge::GetNativeMarkerSnapshot(), "markers");
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
            return trailmarks;
        }

        MenuFramework::Vec2 marker_point(std::string_view marker)
        {
            return {
                static_cast<float>(json_number(marker, "x", -1.0)),
                static_cast<float>(json_number(marker, "y", -1.0)),
            };
        }

        void draw_trailmark_marker(
            MenuFramework::DrawList* draw_list,
            MenuFramework::Vec2 position,
            float scale,
            bool nearest,
            bool in_range)
        {
            const auto dark = rgba(27, 31, 23, 245);
            const auto green = in_range ? rgba(121, 165, 78, 255) : rgba(70, 126, 70, 255);
            const auto gold = rgba(237, 199, 91, 255);
            const auto marker_radius = (nearest ? 6.2F : 5.0F) * scale;

            if (nearest) {
                MenuFramework::draw_circle_filled(draw_list, position, 10.0F * scale, rgba(234, 205, 119, 58));
                MenuFramework::draw_circle(draw_list, position, 8.0F * scale, in_range ? gold : rgba(218, 194, 126, 220), 1.8F);
            }

            MenuFramework::draw_circle_filled(draw_list, position, marker_radius + 1.5F * scale, dark);
            MenuFramework::draw_circle_filled(draw_list, position, marker_radius, green);
            MenuFramework::draw_line(
                draw_list,
                { position.x - 1.4F * scale, position.y + 3.2F * scale },
                { position.x - 1.4F * scale, position.y - 4.8F * scale },
                rgba(241, 224, 173, 255),
                1.2F * scale);
            MenuFramework::draw_triangle_filled(
                draw_list,
                { position.x - 0.7F * scale, position.y - 4.7F * scale },
                { position.x + 4.0F * scale, position.y - 2.8F * scale },
                { position.x - 0.7F * scale, position.y - 0.8F * scale },
                rgba(241, 224, 173, 255));
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

            const MenuFramework::Vec2 map_end{ origin.x + display_size.x, origin.y + display_size.y };
            MenuFramework::draw_rect(draw_list, origin, map_end, rgba(214, 182, 105, 245), 2.0F);
            MenuFramework::draw_rect(
                draw_list,
                { origin.x + 3.0F, origin.y + 3.0F },
                { map_end.x - 3.0F, map_end.y - 3.0F },
                rgba(31, 25, 17, 190),
                1.0F);
            MenuFramework::draw_text(
                draw_list,
                { origin.x + display_size.x * 0.5F - 4.0F, origin.y + 7.0F },
                rgba(32, 26, 18, 230),
                "N");

            const auto player_source = json_object(raw_state, "player_point");
            const MenuFramework::Vec2 player{
                static_cast<float>(json_number(player_source, "x", -1.0)),
                static_cast<float>(json_number(player_source, "y", -1.0)),
            };
            MenuFramework::Vec2 displayed_player{ -1.0F, -1.0F };
            if (player.x >= 0.0F && player.y >= 0.0F) {
                displayed_player = smooth_player_position(
                    player,
                    static_cast<float>(json_number(player_source, "heading", 0.0)));
            } else {
                g_displayed_player = { -1.0F, -1.0F };
            }

            const auto nearest = json_object(raw_state, "nearest_trailmark");
            const auto nearest_id = json_string(nearest, "id");
            const auto nearest_source = json_object(nearest, "point");
            const auto nearest_point = marker_point(nearest_source);

            if (displayed_player.x >= 0.0F && nearest_point.x >= 0.0F) {
                const auto from = map_position(origin, displayed_player, display_size);
                const auto to = map_position(origin, nearest_point, display_size);
                MenuFramework::draw_line(draw_list, from, to, rgba(29, 24, 16, 165), 3.0F);
                MenuFramework::draw_line(draw_list, from, to, rgba(220, 181, 78, 210), 1.2F);
            }

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

            const auto trailmarks = trailmark_snapshot(raw_state);
            const auto radius = (std::max)(2.0F, (trailmark_radius / atlas_map_width) * display_size.x);
            const auto marker_scale = std::clamp(display_size.x / 520.0F, 0.78F, 1.25F);
            for (const auto& trailmark : trailmarks) {
                const auto point = marker_point(trailmark);
                if (point.x < 0.0F || point.y < 0.0F) {
                    continue;
                }
                const auto position = map_position(origin, point, display_size);
                const auto calculated_in_range = player.x >= 0.0F && player.y >= 0.0F &&
                    std::hypot(point.x - player.x, point.y - player.y) <= trailmark_radius;
                const auto in_range = calculated_in_range || json_bool(trailmark, "within_range");
                const auto marker_id = json_string(trailmark, "id");
                const auto is_nearest = (!nearest_id.empty() && marker_id == nearest_id) ||
                    (nearest_point.x >= 0.0F && std::hypot(point.x - nearest_point.x, point.y - nearest_point.y) < 1.0F);
                if (is_nearest || in_range) {
                    MenuFramework::draw_circle(
                        draw_list,
                        position,
                        radius,
                        in_range ? rgba(239, 199, 84, 235) : rgba(102, 146, 82, 185),
                        in_range ? 2.2F : 1.2F);
                }
                draw_trailmark_marker(draw_list, position, marker_scale, is_nearest, in_range);
            }

            if (displayed_player.x >= 0.0F) {
                draw_player_marker(
                    draw_list,
                    map_position(origin, displayed_player, display_size),
                    g_displayed_heading,
                    std::clamp(display_size.x / 520.0F, 0.9F, 1.3F));
            }
        }

        void render_map_key(std::string_view raw_state)
        {
            const auto trailmark_count = trailmark_snapshot(raw_state).size();
            const auto field_mark_count = json_object_array(raw_state, "map_markers").size();
            const auto summary = std::to_string(trailmark_count) + " Trailmarks  |  " +
                std::to_string(field_mark_count) + " field marks";
            muted_text(summary.c_str());
            muted_text("Cyan arrow: you  |  Green flags: Trailmarks  |  Gold route: nearest");
        }

        void queue_action(std::string_view type, std::string payload = "{}")
        {
            LocalBridge::QueueFieldAction(std::string(type), std::move(payload));
            g_status = "Sent to the Ranger Atlas.";
        }

        void queue_clipboard_save()
        {
            const auto content_key = clipboard_content_key();
            if (content_key == g_clipboard_last_queued) {
                return;
            }
            LocalBridge::QueueFieldAction(
                "save_clipboard",
                "{\"title\":\"" + json_escape(g_clipboard_title.data()) +
                    "\",\"body\":\"" + json_escape(g_clipboard_body.data()) + "\"}");
            g_clipboard_last_queued = content_key;
            g_status = "Clipboard saved locally.";
        }

        void render_clipboard(std::string_view nearest)
        {
            muted_text("Keep working notes here while Skyrim continues around you. Notes stay local until you choose an action.");
            accent_text("TITLE");
            MenuFramework::set_next_item_width(field_content_width);
            const auto title_changed = MenuFramework::input_text(
                "##clipboard-title",
                g_clipboard_title.data(),
                g_clipboard_title.size());
            accent_text("NOTES");
            const auto body_changed = MenuFramework::input_text_multiline(
                "##clipboard-body",
                g_clipboard_body.data(),
                g_clipboard_body.size(),
                { field_content_width, 170.0F });
            if (title_changed || body_changed) {
                g_clipboard_dirty = true;
                g_clipboard_last_edit = std::chrono::steady_clock::now();
            }
            if (g_clipboard_dirty &&
                std::chrono::steady_clock::now() - g_clipboard_last_edit > std::chrono::milliseconds(650)) {
                queue_clipboard_save();
            }

            if (MenuFramework::button("Save Clipboard", { 160.0F, 0.0F })) {
                g_clipboard_dirty = true;
                queue_clipboard_save();
            }
            MenuFramework::same_line();
            if (MenuFramework::button("Create Mark Here", { 170.0F, 0.0F })) {
                const std::string title(g_clipboard_title.data());
                if (title.empty()) {
                    g_status = "Give the clipboard note a title first.";
                } else {
                    queue_clipboard_save();
                    queue_action(
                        "create_mark_at_position",
                        "{\"title\":\"" + json_escape(title) +
                            "\",\"notes\":\"" + json_escape(g_clipboard_body.data()) +
                            "\",\"category\":\"landmark\"}");
                    g_status = "Clipboard saved as a field mark at your current position.";
                }
            }
            MenuFramework::same_line();
            if (MenuFramework::button("Send as Field Drop", { 190.0F, 0.0F })) {
                const auto body = std::string(g_clipboard_body.data());
                if (body.empty()) {
                    g_status = "Write clipboard notes before sending a field drop.";
                } else if (nearest.empty() || !json_bool(nearest, "within_range")) {
                    g_status = "Reach an official Trailmark before sending this clipboard.";
                } else {
                    const auto title = std::string(g_clipboard_title.data());
                    const auto message = title.empty() ? body : title + "\n\n" + body;
                    queue_clipboard_save();
                    queue_action(
                        "submit_nearby_trailmark_drop",
                        "{\"message\":\"" + json_escape(message) + "\"}");
                    g_status = "Clipboard sent as a Trailmark field drop and kept locally.";
                }
            }
        }

        void render_nearby_trailmarks(std::string_view raw_state, std::size_t limit)
        {
            const auto trailmarks = json_object_array(raw_state, "official_trailmarks");
            if (trailmarks.empty()) {
                return;
            }

            accent_text("NEARBY TRAILMARKS");
            const auto count = (std::min)(limit, trailmarks.size());
            for (std::size_t index = 0; index < count; ++index) {
                const auto title = json_string(trailmarks[index], "title", "Trailmark");
                const auto navigation = marker_navigation_readout(raw_state, trailmarks[index], true);
                const auto line = std::to_string(index + 1) + ". " + title + "  |  " + navigation;
                if (index == 0) {
                    warning_text(line.c_str());
                } else {
                    muted_text(line.c_str());
                }
            }
        }

        void render_trailmark(std::string_view raw_state, std::string_view nearest)
        {
            if (nearest.empty()) {
                muted_text("No official Trailmark is available.");
                return;
            }

            const auto title = json_string(nearest, "title", "Nearby Trailmark");
            const auto within_range = json_bool(nearest, "within_range");
            if (within_range) {
                success_text("TRAILMARK REACHED");
            } else {
                accent_text("NEAREST TRAILMARK");
            }
            warning_text(title.c_str());
            const auto navigation = navigation_readout(raw_state, nearest, false);
            const auto range_label = navigation + (within_range ? " - within reach" : "");
            muted_text(range_label.c_str());

            const auto distance = static_cast<float>(json_number(nearest, "distance", -1.0));
            if (distance >= 0.0F) {
                const auto progress = std::clamp(trailmark_radius / (std::max)(trailmark_radius, distance), 0.0F, 1.0F);
                MenuFramework::progress_bar(
                    progress,
                    { field_content_width, 22.0F },
                    within_range ? "WITHIN TRAILMARK RADIUS" : nullptr);
            }

            const auto notes = json_string(nearest, "notes");
            if (!notes.empty()) {
                MenuFramework::spacing();
                accent_text("DIRECTIONS");
                muted_text(notes.c_str());
            }

            if (!within_range) {
                MenuFramework::separator();
                muted_text("Follow the gold route on the map. Visitor records and field drops unlock inside the marked radius.");
                MenuFramework::spacing();
                render_nearby_trailmarks(raw_state, 3);
                return;
            }

            MenuFramework::separator();
            accent_text("LEAVE A FIELD DROP");
            muted_text("Send a report from this Trailmark directly through Wayfinder.");
            MenuFramework::input_text_multiline(
                "##field-drop", g_drop_message.data(), g_drop_message.size(), { field_content_width, 68.0F });
            if (MenuFramework::button("Send Field Drop", { 190.0F, 0.0F })) {
                const std::string message(g_drop_message.data());
                if (message.empty()) {
                    g_status = "Write a field drop before sending it.";
                } else {
                    queue_action("submit_nearby_trailmark_drop", "{\"message\":\"" + json_escape(message) + "\"}");
                    g_drop_message.fill('\0');
                }
            }

            MenuFramework::separator();
            accent_text("RECENT VISITORS");
            const auto visitors = json_string_array(nearest, "recent_visitor_lines");
            if (visitors.empty()) {
                muted_text("No recent visits recorded.");
            } else {
                const auto visible_count = (std::min)(recent_visitor_preview_limit, visitors.size());
                for (std::size_t index = 0; index < visible_count; ++index) {
                    muted_text(("- " + visitors[index]).c_str());
                }
                if (visitors.size() > visible_count) {
                    const auto remaining = visitors.size() - visible_count;
                    muted_text(("+ " + std::to_string(remaining) + (remaining == 1 ? " earlier visit" : " earlier visits")).c_str());
                }
            }
            if (MenuFramework::button("Check In Now")) {
                queue_action("record_nearby_trailmark_visit");
            }
            MenuFramework::same_line();
            if (MenuFramework::button("Refresh Visitor Log")) {
                queue_action("refresh_nearby_trailmark_visits");
            }
        }

        void render_mark_form()
        {
            muted_text("Record this exact outdoor position in your browser Atlas.");
            accent_text("TITLE");
            MenuFramework::set_next_item_width(field_content_width);
            MenuFramework::input_text("##mark-title", g_mark_title.data(), g_mark_title.size());
            accent_text("CATEGORY");
            MenuFramework::set_next_item_width(260.0F);
            if (MenuFramework::begin_combo("##mark-category", mark_categories[g_mark_category].label)) {
                for (std::size_t index = 0; index < mark_categories.size(); ++index) {
                    if (MenuFramework::selectable(mark_categories[index].label, index == g_mark_category)) {
                        g_mark_category = index;
                    }
                }
                MenuFramework::end_combo();
            }
            accent_text("NOTES");
            MenuFramework::input_text_multiline(
                "##mark-notes", g_mark_notes.data(), g_mark_notes.size(), { field_content_width, 76.0F });
            if (MenuFramework::button("Create Field Mark", { 190.0F, 0.0F })) {
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
                travel_mode ? MenuFramework::Vec2{ travel_map_size.x + 46.0F, 0.0F } : field_console_size);

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
            sync_clipboard_from_state(raw_state);

            if (travel_mode) {
                accent_text("RANGER ATLAS / TRAVEL");
                if (ready) {
                    render_ranger_profile(raw_state, true);
                    render_awake_ranger_count(raw_state);
                }
                muted_text("F7 close  |  F7 again for field controls");
                MenuFramework::separator();
                if (ready) {
                    render_map(raw_state, travel_map_size);
                    if (g_travel_size != 0) {
                        render_map_key(raw_state);
                    }
                    MenuFramework::separator();
                    if (!nearest.empty()) {
                        const auto title = json_string(nearest, "title", "Trailmark");
                        const auto navigation = navigation_readout(raw_state, nearest, true);
                        if (json_bool(nearest, "within_range")) {
                            success_text("TRAILMARK REACHED");
                            warning_text((title + "  |  " + navigation).c_str());
                            muted_text("Open field controls to check in, view visitors, or leave a drop.");
                        } else {
                            accent_text("NAVIGATING TO");
                            warning_text(title.c_str());
                            muted_text(navigation.c_str());
                        }
                    }
                } else {
                    warning_text("ATLAS LINK UNAVAILABLE");
                    MenuFramework::text_wrapped("Keep the browser Atlas open with your name entered and Live position enabled.");
                }
                MenuFramework::end();
                return;
            }

            accent_text("RANGER ATLAS / FIELD CONSOLE");
            if (MenuFramework::button("Begin Travel View", { 180.0F, 0.0F })) {
                enable_travel_mode();
            }
            MenuFramework::same_line();
            if (MenuFramework::button("Close Atlas", { 120.0F, 0.0F })) {
                if (g_window) {
                    g_window->IsOpen = false;
                }
            }
            MenuFramework::separator();

            if (!ready) {
                warning_text("ATLAS LINK UNAVAILABLE");
                MenuFramework::text_wrapped("Open the Ranger Atlas in your browser, enter your name, and enable Live position.");
                MenuFramework::end();
                return;
            }

            render_ranger_profile(raw_state, false);
            render_awake_ranger_count(raw_state);
            render_map(raw_state, interactive_map_size);
            render_map_key(raw_state);

            MenuFramework::spacing();
            accent_text("TRAVEL VIEW SIZE");
            MenuFramework::set_next_item_width(220.0F);
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
                if (MenuFramework::begin_tab_item("Nearby Trailmark")) {
                    render_trailmark(raw_state, nearest);
                    MenuFramework::end_tab_item();
                }
                if (MenuFramework::begin_tab_item("Create Field Mark")) {
                    render_mark_form();
                    MenuFramework::end_tab_item();
                }
                if (MenuFramework::begin_tab_item("Clipboard")) {
                    render_clipboard(nearest);
                    MenuFramework::end_tab_item();
                }
                MenuFramework::end_tab_bar();
            }

            MenuFramework::separator();
            if (g_status.find("saved") != std::string::npos || g_status.find("Sent") != std::string::npos) {
                success_text(g_status.c_str());
            } else if (g_status != "Ready.") {
                warning_text(g_status.c_str());
            } else {
                muted_text(g_status.c_str());
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
