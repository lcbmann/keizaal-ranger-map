#pragma once

// A deliberately small dynamic binding to SKSE Menu Framework.  Keeping this
// boundary dynamic means Ranger Atlas stays dormant if the optional framework
// is not installed, instead of affecting Skyrim's normal login path.
namespace RangerAtlas::MenuFramework
{
    struct Vec2
    {
        float x;
        float y;
    };

    struct Window
    {
        std::atomic_bool IsOpen{ false };
        std::atomic_bool BlockUserInput{ true };
    };

    using RenderFunction = void(__stdcall*)();

    inline HMODULE module()
    {
        return GetModuleHandleW(L"SKSEMenuFramework");
    }

    template <class T>
    T function(const char* name)
    {
        const auto loaded_module = module();
        return loaded_module ? reinterpret_cast<T>(GetProcAddress(loaded_module, name)) : nullptr;
    }

    inline bool is_available()
    {
        return module() &&
               function<Window* (*)(RenderFunction)>("AddWindow") &&
               function<bool (*)(const char*, bool*, int)>("igBegin") &&
               function<void (*)()>("igEnd") &&
               function<void (*)(const char*, const char*)>("igTextUnformatted") &&
               function<bool (*)(const char*, Vec2)>("igButton");
    }

    inline Window* add_window(RenderFunction render)
    {
        const auto add = function<Window* (*)(RenderFunction)>("AddWindow");
        return add ? add(render) : nullptr;
    }

    inline bool begin(const char* name, bool* open)
    {
        const auto begin_window = function<bool (*)(const char*, bool*, int)>("igBegin");
        return begin_window && begin_window(name, open, 0);
    }

    inline void end()
    {
        if (const auto end_window = function<void (*)()>("igEnd")) {
            end_window();
        }
    }

    inline void text(const char* value)
    {
        if (const auto print = function<void (*)(const char*, const char*)>("igTextUnformatted")) {
            print(value, nullptr);
        }
    }

    inline void separator()
    {
        if (const auto draw = function<void (*)()>("igSeparator")) {
            draw();
        }
    }

    inline void same_line()
    {
        if (const auto draw = function<void (*)(float, float)>("igSameLine")) {
            draw(0.0F, -1.0F);
        }
    }

    inline bool button(const char* label, Vec2 size = { 0.0F, 0.0F })
    {
        const auto draw = function<bool (*)(const char*, Vec2)>("igButton");
        return draw && draw(label, size);
    }

    inline bool input_text(const char* label, char* value, std::size_t size)
    {
        const auto draw = function<bool (*)(const char*, char*, std::size_t, int, void*, void*)>("igInputText");
        return draw && draw(label, value, size, 0, nullptr, nullptr);
    }

    inline bool input_text_multiline(const char* label, char* value, std::size_t size, Vec2 dimensions)
    {
        const auto draw = function<bool (*)(const char*, char*, std::size_t, Vec2, int, void*, void*)>("igInputTextMultiline");
        return draw && draw(label, value, size, dimensions, 0, nullptr, nullptr);
    }
}
