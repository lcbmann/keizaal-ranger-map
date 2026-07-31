#pragma once

#include <string>

namespace RangerAtlas::LocalBridge
{
    void Start();
    void UpdateSnapshot(std::string snapshot);
    void UpdateNativeMarkerSnapshot(std::string snapshot);
    void UpdateFieldState(std::string snapshot);
    std::string GetFieldState();
    void QueueFieldAction(std::string action, std::string payload_json = {});
}
