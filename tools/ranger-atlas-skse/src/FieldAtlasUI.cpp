#include "PCH.h"

#include "FieldAtlasUI.h"
#include "LocalBridge.h"
#include "MenuFrameworkApi.h"

namespace RangerAtlas::FieldAtlasUI
{
    namespace
    {
        MenuFramework::Window* g_window = nullptr;
        std::atomic_bool g_initialized = false;
        std::array<char, 121> g_mark_title = [] {
            std::array<char, 121> value{};
            std::copy_n("Field note", 11, value.begin());
            return value;
        }();
        std::array<char, 801> g_mark_notes{};
        std::array<char, 1801> g_drop_message{};
        std::string g_status = "Ready.";

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
            for (std::size_t index = start + prefix.size() - 1; index < source.size(); ++index) {
                if (source[index] == '{') {
                    ++depth;
                } else if (source[index] == '}' && --depth == 0) {
                    return std::string(source.substr(start + prefix.size() - 1, index - start - prefix.size() + 2));
                }
            }
            return {};
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
                    const auto end = source.find('"', index + 1);
                    if (end == std::string_view::npos) {
                        break;
                    }
                    values.emplace_back(source.substr(index + 1, end - index - 1));
                    index = end + 1;
                } else {
                    ++index;
                }
            }
            return values;
        }

        void queue_action(std::string_view type, std::string payload = "{}")
        {
            LocalBridge::QueueFieldAction(std::string(type), std::move(payload));
            g_status = "Sent to the Ranger Atlas.";
        }

        void __stdcall render_window()
        {
            bool open = true;
            if (!MenuFramework::begin("Ranger Atlas##RangerAtlasFieldConsole", &open)) {
                MenuFramework::end();
                return;
            }

            if (!open && g_window) {
                g_window->IsOpen = false;
            }

            MenuFramework::text("Ranger Atlas - Field Console");
            MenuFramework::text("Field actions are sent through the local Atlas bridge.");
            MenuFramework::separator();

            const auto raw_state = LocalBridge::GetFieldState();
            if (!json_bool(raw_state, "ready")) {
                MenuFramework::text("Atlas link unavailable.");
                MenuFramework::text("Open the Ranger Atlas in a browser once and enable Live position.");
                MenuFramework::separator();
            } else {
                const auto ranger_name = json_string(raw_state, "ranger_name", "Unnamed Ranger");
                const auto game_link = json_string(raw_state, "game_link", "Connected");
                MenuFramework::text(("Signed as: " + ranger_name).c_str());
                MenuFramework::text(("Game link: " + game_link).c_str());

                const auto nearest = json_object(raw_state, "nearest_trailmark");
                if (!nearest.empty()) {
                    MenuFramework::separator();
                    const auto title = json_string(nearest, "title", "Nearby Trailmark");
                    const auto distance = json_number(nearest, "distance");
                    const auto within_range = json_bool(nearest, "within_range");
                    MenuFramework::text(("Trailmark: " + title).c_str());
                    MenuFramework::text(("Distance: " + std::to_string(static_cast<int>(std::round(distance))) +
                        (within_range ? " (in range)" : " (out of range)")).c_str());

                    const auto notes = json_string(nearest, "notes");
                    if (!notes.empty()) {
                        MenuFramework::text(notes.c_str());
                    }

                    if (MenuFramework::button("Record visit")) {
                        queue_action("record_nearby_trailmark_visit");
                    }
                    MenuFramework::same_line();
                    if (MenuFramework::button("Refresh visitors")) {
                        queue_action("refresh_nearby_trailmark_visits");
                    }

                    const auto visitors = json_string_array(nearest, "recent_visitor_lines");
                    if (!visitors.empty()) {
                        MenuFramework::text("Recent visitors:");
                        for (const auto& visitor : visitors) {
                            MenuFramework::text(("- " + visitor).c_str());
                        }
                    }

                    MenuFramework::text("Leave field drop:");
                    MenuFramework::input_text_multiline("##drop", g_drop_message.data(), g_drop_message.size(), { 560.0F, 100.0F });
                    if (MenuFramework::button("Send field drop")) {
                        const std::string message(g_drop_message.data());
                        if (message.empty()) {
                            g_status = "Write a field drop before sending it.";
                        } else if (!within_range) {
                            g_status = "Move within the Trailmark radius before leaving a drop.";
                        } else {
                            queue_action("submit_nearby_trailmark_drop", "{\"message\":\"" + json_escape(message) + "\"}");
                            g_drop_message.fill('\0');
                        }
                    }
                } else {
                    MenuFramework::text("No official Trailmark is nearby.");
                }
            }

            MenuFramework::separator();
            MenuFramework::text("Mark your current position");
            MenuFramework::input_text("Title", g_mark_title.data(), g_mark_title.size());
            MenuFramework::input_text_multiline("Notes", g_mark_notes.data(), g_mark_notes.size(), { 560.0F, 90.0F });
            if (MenuFramework::button("Create field mark")) {
                queue_action(
                    "create_mark_at_position",
                    "{\"title\":\"" + json_escape(g_mark_title.data()) +
                        "\",\"notes\":\"" + json_escape(g_mark_notes.data()) +
                        "\",\"category\":\"landmark\"}");
                g_mark_notes.fill('\0');
            }

            MenuFramework::separator();
            MenuFramework::text(g_status.c_str());
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
        g_initialized = true;
        spdlog::info("Ranger Atlas Field Console registered with SKSE Menu Framework.");
    }

    void Toggle()
    {
        Initialize();
        if (!g_window) {
            RE::DebugNotification("Ranger Atlas needs SKSE Menu Framework for the Field Console.");
            return;
        }
        g_window->IsOpen = !g_window->IsOpen.load();
    }

    void Close()
    {
        if (g_window) {
            g_window->IsOpen = false;
        }
    }
}
