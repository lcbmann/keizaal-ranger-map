#pragma once

#include <string>
#include <vector>

namespace RangerAtlas::LocalBridge
{
    struct NativeMarker
    {
        std::string id;
        std::string title;
        float atlas_x = 0.0F;
        float atlas_y = 0.0F;
    };

    void Start();
    void UpdateSnapshot(std::string snapshot);
    void QueueFieldAction(std::string action);
    void QueueNativeMarker(NativeMarker marker);
    void ClearNativeMarkers();
    std::vector<NativeMarker> TakeNativeMarkers();
    bool TakeNativeMarkerClearRequest();
}
