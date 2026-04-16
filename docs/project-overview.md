# 项目概览

## 项目背景

这个项目最初是一个简单的 Node.js 命令行脚本，用来把 B 站视频弹幕保存为 XML。随着使用场景扩展，目标逐渐从“临时导出”演进为“长期挂机、定期缓存、统一归档、本地浏览”。

项目目前同时覆盖以下需求：

- 手动下载当前视频弹幕
- 批量处理多 P 视频
- 收藏夹定时轮询
- 下载对应视频并缓存到本地
- 自动跳过反复命中的失效 / 下架视频
- 保存视频元数据用于后续展示
- 通过 WebUI 浏览和播放本地库

## 版本演进

| 版本 | 文件 | 定位 |
|:---|:---|:---|
| v1 | `src/get-danmaku.js` | 单 P 命令行工具 |
| v2 | `src/get-danmaku-v2.js` | 多 P / 合并下载命令行工具 |
| v3 | `src/get-danmaku-v3.user.js` | 油猴脚本，适合在浏览器里手动下载或轮询收藏夹 |
| v4 | `src/get-danmaku-v4.user.js` + `danmaku-server.mjs` | 当前主线方案，补齐本地写盘、视频下载、WebUI |

## 当前推荐使用方式

推荐优先使用 `v4`：

- 浏览器负责访问 B 站页面与 API
- 油猴脚本负责前端交互、轮询、组装弹幕
- 本地服务负责写入磁盘、下载视频、暴露 WebUI
- WebUI 负责浏览本地缓存结果

## 当前主要目录

| 路径 | 说明 |
|:---|:---|
| `src/` | 命令行脚本与油猴脚本 |
| `danmaku-server.mjs` | 本地服务主程序 |
| `src/video-format-selector.mjs` | 视频格式选择逻辑 |
| `webui/` | 本地 WebUI 静态资源 |
| `test/` | 当前主要是格式选择单测 |
| `TODO.md` | 用户需求与未完事项 |
| `session/` | 历史对话归档，主要用于追溯上下文 |

## 当前能力摘要

- 弹幕下载
  - 单 P
  - 多 P 分开下载
  - 多 P 合并下载
- 视频下载
  - 使用 `yt-dlp`
  - 支持登录态权限下的高画质下载
  - 支持已有文件复用与画质校验
- 格式选择
  - 同档优先高帧率
  - 在预算内尽量保住更高分辨率
  - 超过 `1 GiB` 时自动降档
- 数据展示
  - 保存 `title / cover / uploader / bvid / updateTime` 等元数据
  - WebUI 展示、本地播放、排序筛选、黑名单管理与 B 站跳转

## 适合先读什么

- 想快速理解整个项目：先看 [`project-overview.md`](project-overview.md)
- 想理解为什么会有 v4 本地服务：看 [`architecture.md`](architecture.md)
- 想直接部署和使用：看 [`usage.md`](usage.md)
- 想了解接口、安全边界或 WebUI：看 [`service-webui-security.md`](service-webui-security.md)
