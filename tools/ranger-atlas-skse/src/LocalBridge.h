#pragma once

#include <string>
#include <string_view>

namespace RangerAtlas::LocalBridge
{
    void Start();
    void UpdateSnapshot(std::string snapshot);
    void UpdateNativeMarkerSnapshot(std::string snapshot);
    bool UpdateFieldState(std::string snapshot, std::string_view origin);
    std::string GetNativeMarkerSnapshot();
    std::string GetFieldState();
    void QueueFieldAction(std::string action, std::string payload_json = {});
}
