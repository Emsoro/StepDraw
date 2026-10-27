// StepDraw —— 类 tldraw 白板，基于 TauriCPP (C++ 后端 + Web 前端)
//
// 职责划分：文档状态与渲染都在前端（保证 60fps 交互）；
//           C++ 提供原生文件对话框、文件读写、PNG 导出、窗口标题等系统能力。
#include "tauricpp/app.hpp"
#include "tauricpp/dialog.hpp"

#include <Windows.h>

#include <algorithm>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using nlohmann::json;

namespace {

constexpr const char* kFileFilterName = "StepDraw Whiteboard";
constexpr const char* kFileFilterPattern = "*.stepdraw";

/// UTF-8 字符串 → 宽字符路径（支持中文路径）
std::wstring ToWide(const std::string& utf8) {
    if (utf8.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
    std::wstring wide(static_cast<size_t>(n > 0 ? n - 1 : 0), L'\0');
    if (n > 1) MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, wide.data(), n);
    return wide;
}

bool WriteFileBinary(const std::wstring& path, const std::string& data) {
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    if (!file.is_open()) return false;
    file.write(data.data(), static_cast<std::streamsize>(data.size()));
    return file.good();
}

bool ReadFileBinary(const std::wstring& path, std::string& out) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) return false;
    std::ostringstream ss;
    ss << file.rdbuf();
    out = ss.str();
    return true;
}

/// base64 解码（用于 PNG 导出）
bool Base64Decode(const std::string& in, std::string& out) {
    auto val = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
    };
    out.clear();
    out.reserve(in.size() / 4 * 3);
    int buf = 0, bits = 0;
    for (char c : in) {
        if (c == '=' || c == '\n' || c == '\r') continue;
        const int v = val(c);
        if (v < 0) return false;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buf >> bits) & 0xFF));
        }
    }
    return true;
}

/// 从路径取文件名（含扩展名），供保存对话框设默认名
std::string BaseName(const std::string& path) {
    size_t p1 = path.find_last_of("/\\");
    return p1 == std::string::npos ? path : path.substr(p1 + 1);
}

}  // namespace

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    tauricpp::App::Config config;
    config.window_config.title = "StepDraw 画板";
    config.window_config.width = 1280;
    config.window_config.height = 800;
    config.window_config.center = true;
    config.window_config.resizable = true;
    config.window_config.devtools = true;                // F12 打开 DevTools
    config.window_config.bg_color = RGB(21, 24, 35);     // 与前端主题同色，消除白屏

    tauricpp::App app(config);
    auto& bridge = app.GetBridge();

    // 打开 .stepdraw 工程文件（原生对话框）
    bridge.RegisterCommand("open_project", [&app](const json&) -> json {
        tauricpp::Dialog::OpenOptions opts;
        opts.title = "打开画板文件";
        opts.default_path = "";
        opts.filters = {{kFileFilterName, kFileFilterPattern}, {"All Files", "*.*"}};

        auto paths = tauricpp::Dialog::OpenFile(app.GetWindow().GetHwnd(), opts);
        json j;
        if (paths.empty()) {
            j["ok"] = false;
            j["reason"] = "cancel";
            return j;
        }
        std::string content;
        if (!ReadFileBinary(ToWide(paths[0]), content)) {
            j["ok"] = false;
            j["reason"] = "read_failed";
            return j;
        }
        j["ok"] = true;
        j["path"] = paths[0];
        j["content"] = content;
        return j;
    });

    // 按已知路径保存（无对话框）
    bridge.RegisterCommand("save_project", [&app](const json& args) -> json {
        const std::string path = args.value("path", "");
        const std::string content = args.value("content", "");
        json j;
        j["ok"] = !path.empty() && WriteFileBinary(ToWide(path), content);
        if (!j["ok"]) j["reason"] = "write_failed";
        return j;
    });

    // 另存为（弹出原生保存对话框，返回选定路径）
    bridge.RegisterCommand("save_project_as", [&app](const json& args) -> json {
        tauricpp::Dialog::SaveOptions opts;
        opts.title = "保存画板文件";
        opts.default_filename = args.value("default_name", "未命名.stepdraw");
        opts.filters = {{kFileFilterName, kFileFilterPattern}, {"All Files", "*.*"}};

        json j;
        auto path = tauricpp::Dialog::SaveFile(app.GetWindow().GetHwnd(), opts);
        if (!path) {
            j["ok"] = false;
            j["reason"] = "cancel";
            return j;
        }
        if (!WriteFileBinary(ToWide(*path), args.value("content", ""))) {
            j["ok"] = false;
            j["reason"] = "write_failed";
            return j;
        }
        j["ok"] = true;
        j["path"] = *path;
        return j;
    });

    // 导出 PNG（base64 数据 → 原生保存对话框 → 写文件）
    bridge.RegisterCommand("export_png", [&app](const json& args) -> json {
        tauricpp::Dialog::SaveOptions opts;
        opts.title = "导出 PNG 图片";
        opts.default_filename = args.value("default_name", "画板.png");
        opts.filters = {{"PNG 图片", "*.png"}, {"All Files", "*.*"}};

        json j;
        auto path = tauricpp::Dialog::SaveFile(app.GetWindow().GetHwnd(), opts);
        if (!path) {
            j["ok"] = false;
            j["reason"] = "cancel";
            return j;
        }
        std::string bytes;
        if (!Base64Decode(args.value("data", ""), bytes)) {
            j["ok"] = false;
            j["reason"] = "bad_base64";
            return j;
        }
        if (!WriteFileBinary(ToWide(*path), bytes)) {
            j["ok"] = false;
            j["reason"] = "write_failed";
            return j;
        }
        j["ok"] = true;
        j["path"] = *path;
        return j;
    });

    // 更新窗口标题（含未保存标记与文件名）
    bridge.RegisterCommand("set_title", [&app](const json& args) -> json {
        app.GetWindow().SetTitle(args.value("title", "StepDraw 画板"));
        return json{{"success", true}};
    });

    // 前端诊断日志
    bridge.RegisterCommand("log_error", [](const json& args) -> json {
        std::ofstream log("stepdraw_error_log.txt", std::ios::app);
        log << args.value("message", "") << std::endl;
        return json{{"success", true}};
    });

    return app.Run();
}
