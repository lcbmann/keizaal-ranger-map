#include "PCH.h"

#include "LocalBridge.h"

namespace RangerAtlas::LocalBridge
{
    namespace
    {
        constexpr std::uint16_t kBridgePort = 38471;

        std::mutex g_snapshot_mutex;
        std::string g_snapshot;
        std::jthread g_server;

        std::string get_snapshot()
        {
            std::scoped_lock lock(g_snapshot_mutex);
            return g_snapshot;
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
                    << "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
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

            std::array<char, 4096> buffer{};
            const auto received = recv(client, buffer.data(), static_cast<int>(buffer.size() - 1), 0);
            if (received <= 0) {
                return;
            }

            const std::string_view request(buffer.data(), static_cast<std::size_t>(received));
            const auto origin = get_origin(request);
            if (!is_allowed_origin(origin)) {
                send_response(client, "403 Forbidden", R"({"error":"origin_not_allowed"})", "");
                return;
            }

            if (request.starts_with("OPTIONS ")) {
                send_response(client, "204 No Content", "", origin, true);
                return;
            }

            if (!request.starts_with("GET /position ")) {
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

            SKSE::log::info("Local bridge listening on http://127.0.0.1:{}/position.", kBridgePort);

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
}
