cmake_minimum_required(VERSION 3.21)

project(RangerAtlas VERSION 0.9.1 LANGUAGES CXX)

find_package(CommonLibSSE CONFIG REQUIRED)

add_commonlibsse_plugin(
    ${PROJECT_NAME}
    SOURCES
        src/PCH.h
        src/FieldAtlasUI.h
        src/FieldAtlasUI.cpp
        src/LocalBridge.h
        src/LocalBridge.cpp
        src/MenuFrameworkApi.h
        src/plugin.cpp
)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)
target_precompile_headers(${PROJECT_NAME} PRIVATE src/PCH.h)
target_link_libraries(${PROJECT_NAME} PRIVATE ws2_32)

if(MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE /W4 /permissive- /Zc:preprocessor)
endif()
