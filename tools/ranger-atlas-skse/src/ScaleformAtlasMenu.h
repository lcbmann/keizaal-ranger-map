#pragma once

namespace RangerAtlas::ScaleformAtlasMenu
{
    void Register();
    bool QueueShow();
    bool ToggleFromHotkey();
    bool IsOpen();
    bool HandleTextEntryEscape();
    bool MapKeyOpensAtlas();
    void SetMapKeyOpensAtlas(bool enabled);
    bool ConsumeNativeMapRequest();
    bool ConsumeMapMenuCloseSuppression();
    void Hide();
    void Reset();
}
