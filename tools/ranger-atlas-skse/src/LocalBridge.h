#pragma once

#include <string>

namespace RangerAtlas::LocalBridge
{
    void Start();
    void UpdateSnapshot(std::string snapshot);
    void QueueFieldAction(std::string action);
}
