#include "PCH.h"

#include "LocalBridge.h"

namespace RangerAtlas::LocalBridge
{
    namespace
    {
        constexpr std::uint16_t kBridgePort = 38471;

        std::mutex g_snapshot_mutex;
        std::string g_snapshot;
        std::mutex g_events_mutex;
        std::deque<std::string> g_events;
        std::uint64_t g_next_event_id = 0;
        std::mutex g_native_markers_mutex;
        std::map<std::string, NativeMarker> g_native_markers;
        bool g_native_marker_clear_requested = false;
        std::jthread g_server;

        std::string get_snapshot()
        {
            std::scoped_lock lock(g_snapshot_mutex);
            return g_snapshot;
        }

        std::string get_events()
        {
            std::scoped_lock lock(g_events_mutex);
            std::ostringstream body;
            body << R"({"events":[)";
            for (std::size_t index = 0; index < g_events.size(); ++index) {
                if (index > 0) {
                    body << ',';
                }
                body << g_events[index];
            }
            body << "]}";
            return body.str();
        }

        std::string get_origin(std::string_view request)
        {
            for (const auto prefix : { "\r\nOrigin: "sv, "\r\norigin: "sv }) {
                const auto start = request.find(prefix);
                if (start == std::string_view::npos) {
                    continue;
                }
                const auto value_start = start + prefix.size();
                const auto value_end = request.find("\r\n", value_start);
                return std::string(request.substr(value_start, value_end - value_start));
            }
            return "";
        }

        bool is_allowed_origin(std::string_view origin)
        {
            return origin.empty() ||
                   origin == "https://lcbmann.github.io" ||
                   origin == "http://localhost" ||
                   origin.starts_with("http://localhost:") ||
                   origin == "http://127.0.0.1" ||
                   origin.starts_with("http://127.0.0.1:");
        }

        std::string header_value(std::string_view request, std::string_view name)
        {
            const auto header_start = request.find(name);
            if (header_start == std::string_view::npos) {
                return "";
            }
            const auto value_start = header_start + name.size();
            const auto value_end = request.find("\r\n", value_start);
            return std::string(request.substr(value_start, value_end - value_start));
        }

        std::string url_decode(std::string_view value)
        {
            std::string decoded;
            decoded.reserve(value.size());
            for (std::size_t index = 0; index < value.size(); ++index) {
                if (value[index] == '+') {
                    decoded.push_back(' ');
                    continue;
                }
                if (value[index] != '%' || index + 2 >= value.size()) {
                    decoded.push_back(value[index]);
                    continue;
                }
                const auto hex = [](char character) -> int {
                    if (character >= '0' && character <= '9') return character - '0';
                    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
                    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
                    return -1;
                };
                const auto high = hex(value[index + 1]);
                const auto low = hex(value[index + 2]);
                if (high < 0 || low < 0) {
                    decoded.push_back(value[index]);
                    continue;
                }
                decoded.push_back(static_cast<char>((high << 4) | low));
                index += 2;
            }
            return decoded;
        }

        std::map<std::string, std::string> parse_form(std::string_view body)
        {
            std::map<std::string, std::string> fields;
            while (!body.empty()) {
                const auto separator = body.find('&');
                const auto part = body.substr(0, separator);
                const auto equals = part.find('=');
                if (equals != std::string_view::npos) {
                    fields[url_decode(part.substr(0, equals))] = url_decode(part.substr(equals + 1));
                }
                if (separator == std::string_view::npos) {
                    break;
                }
                body.remove_prefix(separator + 1);
            }
            return fields;
        }

        bool finite_float(std::string_view value, float& result)
        {
            try {
                std::size_t consumed = 0;
                const auto parsed = std::stof(std::string(value), &consumed);
                if (consumed != value.size() || !std::isfinite(parsed)) {
                    return false;
                }
                result = parsed;
                return true;
            } catch (...) {
                return false;
            }
        }

        void send_all(SOCKET socket, std::string_view response)
        {
            std::size_t sent_total = 0;
            while (sent_total < response.size()) {
                const auto remaining = response.size() - sent_total;
                const auto sent = send(
                    socket,
                    response.data() + sent_total,
                    static_cast<int>(std::min<std::size_t>(remaining, INT_MAX)),
                    0);
                if (sent == SOCKET_ERROR || sent == 0) {
                    return;
                }
                sent_total += static_cast<std::size_t>(sent);
            }
        }

        void send_response(
            SOCKET client,
            std::string_view status,
            std::string_view body,
            std::string_view origin,
            bool allow_options = false)
        {
            std::ostringstream response;
            response
                << "HTTP/1.1 " << status << "\r\n"
                << "Content-Type: application/json; charset=utf-8\r\n"
                << "Content-Length: " << body.size() << "\r\n"
                << "Cache-Control: no-store\r\n";
            if (!origin.empty()) {
                response
                    << "Access-Control-Allow-Origin: " << origin << "\r\n"
                    << "Vary: Origin\r\n"
                    << "Access-Control-Allow-Private-Network: true\r\n";
            }
            if (allow_options) {
                response
                    << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    << "Access-Control-Allow-Headers: Content-Type\r\n"
                    << "Access-Control-Max-Age: 600\r\n";
            }
            response << "Connection: close\r\n\r\n" << body;
            send_all(client, response.str());
        }

        void handle_client(SOCKET client)
        {
            constexpr DWORD timeout_ms = 1000;
            setsockopt(
                client,
                SOL_SOCKET,
                SO_RCVTIMEO,
                reinterpret_cast<const char*>(&timeout_ms),
                sizeof(timeout_ms));

            std::string request;
            std::array<char, 4096> buffer{};
            std::size_t expected_size = 0;
            while (request.size() < 16384) {
                const auto received = recv(client, buffer.data(), static_cast<int>(buffer.size()), 0);
                if (received <= 0) {
                    break;
                }
                request.append(buffer.data(), static_cast<std::size_t>(received));
                const auto header_end = request.find("\r\n\r\n");
                if (header_end == std::string::npos) {
                    continue;
                }
                const auto content_length = header_value(request, "\r\nContent-Length: ");
                expected_size = header_end + 4;
                if (!content_length.empty()) {
                    try {
                        expected_size += std::stoul(content_length);
                    } catch (...) {
                        expected_size = request.size();
                    }
                }
                if (request.size() >= expected_size) {
                    break;
                }
            }
            if (request.empty()) {
                return;
            }

            const std::string_view request_view(request);
            const auto origin = get_origin(request_view);
            if (!is_allowed_origin(origin)) {
                send_response(client, "403 Forbidden", R"({"error":"origin_not_allowed"})", "");
                return;
            }

            if (request_view.starts_with("OPTIONS ")) {
                send_response(client, "204 No Content", "", origin, true);
                return;
            }

            if (request_view.starts_with("GET /events ")) {
                send_response(client, "200 OK", get_events(), origin);
                return;
            }

            if (request_view.starts_with("POST /markers/clear ")) {
                ClearNativeMarkers();
                send_response(client, "200 OK", R"({"ok":true})", origin);
                return;
            }

            if (request_view.starts_with("POST /markers ")) {
                const auto header_end = request_view.find("\r\n\r\n");
                const auto body = header_end == std::string_view::npos
                    ? std::string_view{}
                    : request_view.substr(header_end + 4);
                const auto fields = parse_form(body);
                NativeMarker marker;
                marker.id = fields.contains("id") ? fields.at("id") : "";
                marker.title = fields.contains("title") ? fields.at("title") : "";
                if (marker.id.empty() || marker.title.empty() || marker.title.size() > 160 ||
                    !finite_float(fields.contains("x") ? fields.at("x") : "", marker.atlas_x) ||
                    !finite_float(fields.contains("y") ? fields.at("y") : "", marker.atlas_y)) {
                    send_response(client, "400 Bad Request", R"({"error":"invalid_marker"})", origin);
                    return;
                }
                QueueNativeMarker(std::move(marker));
                send_response(client, "200 OK", R"({"ok":true})", origin);
                return;
            }

            if (!request_view.starts_with("GET /position ")) {
                send_response(client, "404 Not Found", R"({"error":"not_found"})", origin);
                return;
            }

            const auto snapshot = get_snapshot();
            if (snapshot.empty()) {
                send_response(client, "503 Service Unavailable", R"({"ready":false})", origin);
                return;
            }

            send_response(client, "200 OK", snapshot, origin);
        }

        void serve(std::stop_token stop_token)
        {
            WSADATA winsock_data{};
            if (WSAStartup(MAKEWORD(2, 2), &winsock_data) != 0) {
                SKSE::log::error("Local bridge could not initialize Winsock.");
                return;
            }

            const auto server = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
            if (server == INVALID_SOCKET) {
                SKSE::log::error("Local bridge could not create its loopback socket.");
                WSACleanup();
                return;
            }

            constexpr BOOL reuse_address = TRUE;
            setsockopt(
                server,
                SOL_SOCKET,
                SO_REUSEADDR,
                reinterpret_cast<const char*>(&reuse_address),
                sizeof(reuse_address));

            sockaddr_in address{};
            address.sin_family = AF_INET;
            address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            address.sin_port = htons(kBridgePort);

            if (bind(server, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR ||
                listen(server, SOMAXCONN) == SOCKET_ERROR) {
                SKSE::log::error(
                    "Local bridge could not listen on 127.0.0.1:{} (Winsock error {}).",
                    kBridgePort,
                    WSAGetLastError());
                closesocket(server);
                WSACleanup();
                return;
            }

            SKSE::log::info(
                "Local bridge listening on http://127.0.0.1:{}/position and /events.",
                kBridgePort);

            while (!stop_token.stop_requested()) {
                fd_set read_set;
                FD_ZERO(&read_set);
                FD_SET(server, &read_set);
                timeval timeout{ 0, 250000 };
                const auto ready = select(0, &read_set, nullptr, nullptr, &timeout);
                if (ready <= 0 || !FD_ISSET(server, &read_set)) {
                    continue;
                }

                const auto client = accept(server, nullptr, nullptr);
                if (client == INVALID_SOCKET) {
                    continue;
                }

                handle_client(client);
                shutdown(client, SD_BOTH);
                closesocket(client);
            }

            closesocket(server);
            WSACleanup();
        }
    }

    void Start()
    {
        if (g_server.joinable()) {
            return;
        }
        g_server = std::jthread(serve);
    }

    void UpdateSnapshot(std::string snapshot)
    {
        std::scoped_lock lock(g_snapshot_mutex);
        g_snapshot = std::move(snapshot);
    }

    void QueueFieldAction(std::string action)
    {
        std::scoped_lock lock(g_events_mutex);
        const auto now_ms = static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());
        const auto event_id = (std::max)(now_ms, g_next_event_id + 1);
        g_next_event_id = event_id;
        std::ostringstream event;
        event << R"({"id":)" << event_id
              << R"(,"type":")" << action
              << R"(","created_at_unix_ms":)"
              << now_ms;

        const auto snapshot = get_snapshot();
        if (!snapshot.empty()) {
            event << R"(,"snapshot":)" << snapshot;
        }
        event << '}';

        g_events.push_back(event.str());
        while (g_events.size() > 16) {
            g_events.pop_front();
        }
        SKSE::log::info("Queued field action '{}' with event id {}.", action, event_id);
    }

    void QueueNativeMarker(NativeMarker marker)
    {
        std::scoped_lock lock(g_native_markers_mutex);
        g_native_markers[marker.id] = std::move(marker);
    }

    void ClearNativeMarkers()
    {
        std::scoped_lock lock(g_native_markers_mutex);
        g_native_marker_clear_requested = true;
        g_native_markers.clear();
    }

    std::vector<NativeMarker> TakeNativeMarkers()
    {
        std::scoped_lock lock(g_native_markers_mutex);
        std::vector<NativeMarker> markers;
        markers.reserve(g_native_markers.size());
        for (auto& [id, marker] : g_native_markers) {
            markers.push_back(std::move(marker));
        }
        g_native_markers.clear();
        return markers;
    }

    bool TakeNativeMarkerClearRequest()
    {
        std::scoped_lock lock(g_native_markers_mutex);
        const auto requested = g_native_marker_clear_requested;
        g_native_marker_clear_requested = false;
        return requested;
    }
}
