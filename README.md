# StepDraw 画板

一个类 [tldraw](https://www.tldraw.com/) 的桌面白板画图工具，支持文本、铅笔自由手绘、流程图（图形 + 自动连接箭头）等。基于自研的 **TauriCPP** 框架（C++17 + Win32 + WebView2），前端资源直接嵌入 exe，构建产物为**单文件、无 DLL 依赖**的绿色应用。

## 功能

### 绘图工具
| 工具 | 快捷键 | 说明 |
| --- | --- | --- |
| 选择 | `V` | 点选 / `Shift` 多选 / 框选 / 拖动移动 / 8 向手柄缩放 |
| 手型 | `H` | 平移画布（也可按住 `空格` 或鼠标中键拖动） |
| 铅笔 | `D` | 自由手绘，二次贝塞尔平滑 + 冗余点简化 |
| 橡皮 | `E` | 点击或划过图形擦除，悬停红色高亮 |
| 矩形 | `R` | 拖动绘制，`Shift` 正方形，单击生成默认大小 |
| 椭圆 | `O` | 拖动绘制，`Shift` 正圆 |
| 菱形 | `F` | 流程图判断框 |
| 箭头 | `A` | 从图形拖到图形**自动连接**；图形四边中点为连接点（磁吸），拖动端点可随时改接到别的图形；可切换**直线 / 折线**路由 |
| 文本 | `T` | 点击画布放置；双击空白处也可新建文本 |

### 流程图
- 矩形 / 椭圆 / 菱形均可双击编辑**内部标签**（自动换行居中）
- 箭头端点在图形**四边中点吸附为连接点**（Visio 风格），移动图形时连线实时跟随
- 连好的箭头两端有拖拽手柄：拖到其他图形上即改接（可换连接点），拖到空白处则解绑为自由点
- 折线路由默认开启，可切换为直线；切换线型只改变中间走法，**两端位置保持不变**
- 删除图形时，绑定到它的连线端点自动冻结为绝对坐标

### 编辑与视图
- 撤销 / 重做（200 步历史）：`Ctrl+Z` / `Ctrl+Shift+Z`
- 复制选中 `Ctrl+D`、全选 `Ctrl+A`、删除 `Delete`
- 滚轮缩放（光标锚点，10%–400%）、`Ctrl+0` 复位、`Shift+1` 适应内容
- 样式面板：马卡龙描边 / 填充调色板、线宽三档、实线 / 虚线 / 点线、字号三档
- 字体下拉：默认（无衬线）/ 宋体 / 黑体 / 楷体 / 仿宋 / 幼圆 / 等宽 / 西文衬线，选项可直接预览字形
- 样式面板可**折叠**（右上角按钮）：折叠后只留一条窄栏，画布变宽，宽高自动重算，状态下次启动恢复

### 文件
- 保存 / 打开 / 另存为：原生文件对话框，`.stepdraw` JSON 格式
- 导出 **PNG**：2× 分辨率，白色背景
- 导出 **SVG**：真矢量输出，矩形 / 椭圆 / 菱形 / 自由笔迹 / 连线 / 箭头 / 文字全部为可缩放的 SVG 元素，文字保留字体与换行
- 草稿自动保存：未保存内容定时写入本地，重启自动恢复
- 标题栏显示当前文件名与未保存标记 `•`

## 构建环境

- Windows 10/11
- Visual Studio 2022（含 C++ 桌面开发工作负载）
- CMake 3.15+
- [vcpkg](https://vcpkg.io/)，已安装 WebView2 SDK：
  ```powershell
  vcpkg install webview2:x64-windows-static --classic
  ```
  （`vcpkg` 需设置 `VCPKG_ROOT` 环境变量，或安装在 `C:\vcpkg`）

## 构建

```powershell
# 标准构建（前端资源嵌入 exe）
powershell -ExecutionPolicy Bypass -File build.ps1

# 开发模式（前端从 ./frontend 目录热加载，改 UI 无需重新编译）
powershell -ExecutionPolicy Bypass -File build.ps1 -DevMode
```

产物：`build\Release\StepDraw.exe`

> 首次配置时若缺少 `TauriCPP/third_party/nlohmann/json.hpp`，CMake 会自动从 GitHub 下载。
>
> 版本号只维护一处：`CMakeLists.txt` 的 `project(StepDraw VERSION x.y.z)`，通过编译宏传入 exe，运行时由 `app_info` 命令提供给前端右上角显示。

## 使用

双击 `StepDraw.exe` 即可运行（无需安装）。WebView2 运行时随 Windows 11 / Edge 分发，Windows 10 如缺失会自动引导安装。

常用操作：
- 双击图形编辑文字，双击空白新建文本
- 拖动图形时，绑定的箭头自动跟随重连
- `F12` 打开 DevTools 调试前端

## 项目结构

```
StepDraw/
├── build.ps1              # 一键构建脚本（CMake + MSVC）
├── CMakeLists.txt
├── src/
│   ├── main.cpp           # 窗口 + 原生桥接命令（文件对话框/读写/导出/标题）
│   └── app.ico
├── frontend/              # Web 前端（打包嵌入 exe）
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── bridge.js      # 原生桥 + 浏览器 mock（localStorage）
│       ├── geometry.js    # 包围盒/命中测试/箭头路由/连接点/文本排版
│       ├── state.js       # 文档模型 + 撤销/重做历史
│       ├── render.js      # Canvas 渲染（相机变换/网格/选区/箭头端点手柄）
│       ├── svg.js         # SVG 矢量导出（与 canvas 共用几何与样式参数）
│       ├── tools.js       # 指针交互状态机（各工具行为）
│       └── app.js         # UI 装配/文本编辑/文件操作/快捷键
└── TauriCPP/              # 内嵌 C++ 框架（Win32 窗口 + WebView2 + IPC 桥）
```

### 架构说明

- **前端持有全部文档状态**（图形、相机、选择集），保证 60fps 交互；Canvas 2D 渲染，Per-Monitor DPI 感知。
- **C++ 只提供系统能力**：打开 / 保存对话框、文件读写、PNG base64 解码与 SVG 文本落盘、窗口标题、用默认浏览器打开链接、版本信息、错误日志。
- 前后端通过 `window.__tauricpp__.invoke(cmd, args)`（Promise）与 `bridge.Emit` 双向通信；在浏览器中打开 `frontend/index.html` 时自动降级为 localStorage mock，便于脱离 C++ 调试前端。

### 数据格式（.stepdraw）

```json
{
  "version": 1,
  "app": "stepdraw",
  "shapes": [
    { "id": "…", "type": "rect|ellipse|diamond|text|draw|arrow",
      "x": 0, "y": 0, "w": 100, "h": 60, "label": "",
      "props": { "stroke": "#1d1d21", "fill": "transparent",
                 "size": "m", "dash": "solid", "font": "m",
                 "family": "sans", "route": "elbow" },
      "points": [],              // draw：手绘点集
      "a": { "id": "…", "x": 0, "y": 0 },   // arrow：起点（id 为绑定的图形）
      "b": { "x": 0, "y": 0 }               // arrow：终点
    }
  ],
  "camera": { "x": 0, "y": 0, "z": 1 }
}
```

## 快捷键总览

| 操作 | 快捷键 |
| --- | --- |
| 工具切换 | `V` `H` `D` `E` `R` `O` `F` `A` `T` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z`（或 `Ctrl+Y`） |
| 保存 / 另存为 / 打开 | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` |
| 复制 / 全选 | `Ctrl+D` / `Ctrl+A` |
| 删除选中 | `Delete` 或 `Backspace` |
| 缩放 | 滚轮 / `Ctrl+=` `Ctrl+-` / `Ctrl+0` 复位 |
| 适应内容 | `Shift+1` 或缩放条「适应」 |
| 平移 | 空格 + 拖动 / 鼠标中键拖动 / 手型工具 |
| 结束文本编辑 | `Esc`（取消）/ `Ctrl+Enter`（确认） |

## 链接与反馈

- GitHub：[Emsoro/StepDraw](https://github.com/Emsoro/StepDraw)
- Gitee：[masonwu21/StepDraw](https://gitee.com/masonwu21/StepDraw)

程序右上角显示当前版本号与 GitHub / Gitee 图标，点击会调用系统默认浏览器打开对应仓库；问题与建议欢迎提 Issue。

## 赞赏

如果 StepDraw 对你有帮助，欢迎扫码支持一下，感谢每一份鼓励：

<p align="center">
  <img src="Donate.jpg" width="280" alt="masonwu21 的赞赏码">
</p>

