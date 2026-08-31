#pragma once

namespace RangerAtlas::FieldAtlasUI
{
    void Initialize();
    void Toggle();
    void OpenTravel();
    bool HandleFieldKey();
    void Close();
    void SetMapMenuOpen(bool open);
    bool OwnsInput();
}
