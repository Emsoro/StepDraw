cmake_minimum_required(VERSION 3.15)
project(StepDraw VERSION 1.0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 静态 CRT，配合 vcpkg 的 x64-windows-static triplet，生成无 DLL 依赖的单文件 exe
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
if(MSVC)
    add_compile_options(/utf-8)
endif()

option(EMBED_FRONTEND "把前端资源嵌入 exe（关闭时从 ./frontend 目录热加载）" ON)

# ============================================================================
# TauriCPP 框架引用（项目内置 TauriCPP 目录）
# ============================================================================
set(TAURICPP_DIR "${CMAKE_SOURCE_DIR}/TauriCPP" CACHE PATH "TauriCPP 框架根目录")
if(NOT EXISTS "${TAURICPP_DIR}/include/tauricpp/app.hpp")
    message(FATAL_ERROR "未找到 TauriCPP 框架: ${TAURICPP_DIR}")
endif()

set(NLOHMANN_INCLUDE_DIR "${TAURICPP_DIR}/third_party")
if(NOT EXISTS "${NLOHMANN_INCLUDE_DIR}/nlohmann/json.hpp")
    message(STATUS "Downloading nlohmann/json.hpp...")
    file(DOWNLOAD
        "https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp"
        "${NLOHMANN_INCLUDE_DIR}/nlohmann/json.hpp"
        SHOW_PROGRESS
    )
endif()

set(WEBVIEW2_SEARCH_PATHS
    "$ENV{VCPKG_ROOT}/installed/x64-windows-static"
    "$ENV{VCPKG_ROOT}/installed/x64-windows"
    "C:/vcpkg/installed/x64-windows-static"
    "C:/vcpkg/installed/x64-windows"
)

find_path(WEBVIEW2_INCLUDE_DIR
    NAMES WebView2.h
    PATH_SUFFIXES include
    PATHS ${WEBVIEW2_SEARCH_PATHS}
)

find_library(WEBVIEW2_LIBRARY
    NAMES WebView2LoaderStatic WebView2Loader.dll.lib
    PATH_SUFFIXES lib
    PATHS ${WEBVIEW2_SEARCH_PATHS}
)

if(NOT WEBVIEW2_INCLUDE_DIR OR NOT WEBVIEW2_LIBRARY)
    message(FATAL_ERROR
        "WebView2 SDK not found!\n"
        "Install via: vcpkg install webview2:x64-windows-static --classic"
    )
endif()

message(STATUS "WebView2 include: ${WEBVIEW2_INCLUDE_DIR}")
message(STATUS "WebView2 library: ${WEBVIEW2_LIBRARY}")

file(GLOB TAURICPP_SOURCES CONFIGURE_DEPENDS "${TAURICPP_DIR}/src/*.cpp")

add_library(tauricpp STATIC ${TAURICPP_SOURCES})
target_include_directories(tauricpp PUBLIC
    "${TAURICPP_DIR}/include"
    "${NLOHMANN_INCLUDE_DIR}"
    "${WEBVIEW2_INCLUDE_DIR}"
)
target_link_libraries(tauricpp PUBLIC
    shlwapi
    shell32
    comdlg32
    ole32
    ${WEBVIEW2_LIBRARY}
)

# ============================================================================
# 前端资源打包
# ============================================================================
set(FRONTEND_DIR "${CMAKE_SOURCE_DIR}/frontend")
set(GEN_DIR "${CMAKE_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${GEN_DIR}")
set(RESOURCES_RC "${GEN_DIR}/resources.rc")
set(RESOURCE_MAP_CPP "${GEN_DIR}/resource_map.cpp")

find_package(Python3 COMPONENTS Interpreter)

if(EMBED_FRONTEND AND Python3_Interpreter_FOUND)
    file(GLOB_RECURSE FRONTEND_FILES CONFIGURE_DEPENDS "${FRONTEND_DIR}/*")
    add_custom_command(
        OUTPUT "${RESOURCES_RC}" "${RESOURCE_MAP_CPP}"
        COMMAND ${Python3_EXECUTABLE} "${TAURICPP_DIR}/tools/pack_resources.py"
                "${FRONTEND_DIR}" -o "${RESOURCES_RC}" -t "TAURI_RES"
        DEPENDS "${TAURICPP_DIR}/tools/pack_resources.py" ${FRONTEND_FILES}
        COMMENT "Packing frontend resources into .rc file"
        VERBATIM
    )
else()
    # 开发模式：不嵌入资源，运行时从 exe 同级的 frontend 目录加载
    file(WRITE "${RESOURCES_RC}" "// Auto-generated: frontend not embedded\n")
    file(WRITE "${RESOURCE_MAP_CPP}"
        "// Auto-generated: frontend not embedded (dev mode)\n"
        "#include <Windows.h>\n\n"
        "namespace tauricpp {\n"
        "void VirtualFS::LoadFromResources(HMODULE) {}\n"
        "} // namespace tauricpp\n"
    )
endif()

# ============================================================================
# 主程序
# ============================================================================
set(APP_ADDITIONAL_SOURCES "")
if(MSVC)
    # 版本信息资源
    file(WRITE "${GEN_DIR}/app_version.rc"
        "#include <windows.h>\n"
        "VS_VERSION_INFO VERSIONINFO\n"
        " FILEVERSION ${PROJECT_VERSION_MAJOR},${PROJECT_VERSION_MINOR},${PROJECT_VERSION_PATCH},0\n"
        " PRODUCTVERSION ${PROJECT_VERSION_MAJOR},${PROJECT_VERSION_MINOR},${PROJECT_VERSION_PATCH},0\n"
        " FILEFLAGSMASK 0x3fL\n"
        " FILEFLAGS 0x0L\n"
        " FILEOS VOS_NT_WINDOWS32\n"
        " FILETYPE VFT_APP\n"
        " FILESUBTYPE VFT2_UNKNOWN\n"
        "BEGIN\n"
        "    BLOCK \"StringFileInfo\"\n"
        "    BEGIN\n"
        "        BLOCK \"040904b0\"\n"
        "        BEGIN\n"
        "            VALUE \"CompanyName\", \"StepDraw\"\n"
        "            VALUE \"FileDescription\", \"StepDraw Whiteboard - TauriCPP\"\n"
        "            VALUE \"FileVersion\", \"${PROJECT_VERSION}\"\n"
        "            VALUE \"InternalName\", \"StepDraw\"\n"
        "            VALUE \"LegalCopyright\", \"Copyright (c) 2026 StepDraw\"\n"
        "            VALUE \"OriginalFilename\", \"StepDraw.exe\"\n"
        "            VALUE \"ProductName\", \"StepDraw\"\n"
        "            VALUE \"ProductVersion\", \"${PROJECT_VERSION}\"\n"
        "        END\n"
        "    END\n"
        "    BLOCK \"VarFileInfo\"\n"
        "    BEGIN\n"
        "        VALUE \"Translation\", 0x409, 1200\n"
        "    END\n"
        "END\n"
    )
    list(APPEND APP_ADDITIONAL_SOURCES "${GEN_DIR}/app_version.rc")

    # 应用图标
    file(WRITE "${GEN_DIR}/app_icon.rc"
        "// 应用图标\n"
        "1 ICON \"${CMAKE_SOURCE_DIR}/src/app.ico\"\n"
    )
    list(APPEND APP_ADDITIONAL_SOURCES "${GEN_DIR}/app_icon.rc")
    set_source_files_properties("${GEN_DIR}/app_icon.rc" PROPERTIES
        OBJECT_DEPENDS "${CMAKE_SOURCE_DIR}/src/app.ico")

    # Per-Monitor DPI 感知
    file(WRITE "${GEN_DIR}/dpi_awareness.manifest"
        "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n"
        "<assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'>\n"
        "  <trustInfo xmlns=\"urn:schemas-microsoft-com:asm.v3\">\n"
        "    <security>\n"
        "      <requestedPrivileges>\n"
        "        <requestedExecutionLevel level='asInvoker' uiAccess='false' />\n"
        "      </requestedPrivileges>\n"
        "    </security>\n"
        "  </trustInfo>\n"
        "  <application>\n"
        "    <windowsSettings>\n"
        "      <dpiAware xmlns='http://schemas.microsoft.com/SMI/2005/WindowsSettings'>true/pm</dpiAware>\n"
        "      <dpiAwareness xmlns='http://schemas.microsoft.com/SMI/2016/WindowsSettings'>PerMonitorV2</dpiAwareness>\n"
        "    </windowsSettings>\n"
        "  </application>\n"
        "  <compatibility xmlns='urn:schemas-microsoft-com:compatibility.v1'>\n"
        "    <application>\n"
        "      <supportedOS Id='{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}'/>\n"
        "    </application>\n"
        "  </compatibility>\n"
        "</assembly>")
    list(APPEND APP_ADDITIONAL_SOURCES "${GEN_DIR}/dpi_awareness.manifest")
endif()

add_executable(StepDraw WIN32
    src/main.cpp
    "${RESOURCES_RC}"
    "${RESOURCE_MAP_CPP}"
    ${APP_ADDITIONAL_SOURCES}
)

target_include_directories(StepDraw PRIVATE "${GEN_DIR}")
target_link_libraries(StepDraw PRIVATE tauricpp)
# 版本号单一来源：前端右上角从 app_info 命令读取
target_compile_definitions(StepDraw PRIVATE STEPDRAW_VERSION="${PROJECT_VERSION}")
