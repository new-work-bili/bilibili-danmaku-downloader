# AGENTS

## 目标

这个文件是后续 AI 进入本项目时的首读入口。目标不是替代全部文档，而是快速回答下面几个问题：

- 这个项目是做什么的
- 当前主线方案是什么
- 相关知识应该去哪里看
- 改动后哪些文档必须同步更新

## 项目一句话说明

这是一个把 B 站视频弹幕与对应视频缓存到本地的项目，包含命令行工具、Tampermonkey 油猴脚本、本地 Node.js 服务和一个本地 WebUI。

## 当前推荐主线

优先理解并维护 `v4`：

- 前端：`src/get-danmaku-v4.user.js`
- 服务端：`danmaku-server.mjs`
- 格式选择：`src/video-format-selector.mjs`
- WebUI：`webui/`

`v1 / v2 / v3` 仍然保留，但主要用于兼容和轻量使用场景。

## 先读哪些文档

### 1. 全局概览

先读：

- [`README.md`](README.md)
- [`docs/project-overview.md`](docs/project-overview.md)

用于理解：

- 项目背景
- 各版本定位
- 当前能力与目录结构

### 2. 架构与设计取舍

再读：

- [`docs/architecture.md`](docs/architecture.md)

用于理解：

- 为什么从 v3 演进到 v4
- 多标签页租约锁
- 本地服务职责
- 视频格式选择策略

### 3. 部署与使用

如果任务涉及运行、部署、操作流程，读：

- [`docs/usage.md`](docs/usage.md)

用于理解：

- 命令行用法
- v3 / v4 安装方式
- PM2 启动方式
- WebUI 入口

### 4. WebUI、接口与安全

如果任务涉及接口、浏览器、本地服务、安全边界，读：

- [`docs/service-webui-security.md`](docs/service-webui-security.md)

用于理解：

- `localhost` 服务提供哪些接口
- WebUI 当前支持什么
- 视频下载登录态从哪里来
- 当前已知安全边界和风险面

### 5. 当前需求与未完事项

如果任务涉及下一步需求、产品方向、待办，读：

- [`TODO.md`](TODO.md)

### 6. 历史上下文

如果任务需要追溯上一个迭代的排障过程或决策背景，可参考：

- `session/` 目录中的 `2026-03-21.../session.json` 历史归档

注意：

- `session/` 是历史归档，不应代替当前代码与当前文档
- 若历史结论与当前代码冲突，以当前代码为准，并同步修正文档

## 代码入口索引

### 命令行

- `src/get-danmaku.js`
- `src/get-danmaku-v2.js`

### 油猴脚本

- `src/get-danmaku-v3.user.js`
- `src/get-danmaku-v4.user.js`

### 服务端

- `danmaku-server.mjs`

### 视频格式选择

- `src/video-format-selector.mjs`
- `test/video-format-selector.test.mjs`

### WebUI

- `webui/index.html`
- `webui/app.js`
- `webui/style.css`

## AI 进入任务时的默认工作方式

1. 先确认用户是在问 v1 / v2 / v3 / v4 哪条链路
2. 若未说明，默认按 `v4` 主线理解
3. 先读相关代码，再读相关文档，不要只根据历史对话下结论
4. 涉及视频画质、大小限制、cookie、WebUI、安全时，优先检查 `danmaku-server.mjs` 与 `src/video-format-selector.mjs`
5. 涉及轮询、防重复、收藏夹逻辑时，优先检查 `src/get-danmaku-v4.user.js`

## 修改后要同步更新哪些文档

### 改了功能入口或使用方式

更新：

- [`README.md`](README.md)
- [`docs/usage.md`](docs/usage.md)

### 改了架构、职责边界、调度方式、格式选择策略

更新：

- [`docs/architecture.md`](docs/architecture.md)
- 必要时更新 [`docs/project-overview.md`](docs/project-overview.md)

### 改了本地服务接口、WebUI 能力或安全边界

更新：

- [`docs/service-webui-security.md`](docs/service-webui-security.md)
- 必要时更新 [`README.md`](README.md)

### 改了产品方向、待办项、未解决问题

更新：

- [`TODO.md`](TODO.md)

### 做了一次关键迭代、排障或行为变化较大的修复

建议至少检查：

- `README.md`
- 对应 `docs/*.md`
- `AGENTS.md`

## 文档维护原则

- `README.md` 保持轻量，做首页和导航，不要再无限膨胀
- 详细内容写到 `docs/`
- `AGENTS.md` 只做入口和协作说明，不堆实现细节
- 如果文档与代码不一致，修代码的同时也修文档
- 如果新增了重要文档，记得把入口补到 `README.md` 和 `AGENTS.md`
