# 迭代记录

这个文档用于按迭代记录需求变化、已完成内容、遗留问题和文档更新情况。

维护约定：

- 按时间倒序追加，最新迭代放在最上面
- 重点记录“为什么改、改了什么、还剩什么”
- 不替代 `TODO.md`
  - `TODO.md` 偏向当前待办与需求池
  - 本文档偏向每轮迭代的结果归档
- 发生重要排障、架构变化、能力上线时同步更新

建议模板：

```md
## YYYY-MM-DD 迭代标题

### 背景

### 本轮目标

### 已完成

### 遗留事项

### 涉及文件

### 文档更新
```

## 2026-03-26 v4 多 P 下载与轮询弹幕目录重构

### 背景

收藏夹轮询原先会把多 P 弹幕合并后写入时间戳目录，同时视频下载只按 BV 触发一次，导致多 P 视频通常只会下载第一 P，弹幕目录也会持续膨胀。

### 本轮目标

- 让多 P 视频按分 P 全量下载
- 让轮询弹幕改为固定目录覆盖
- 让 WebUI 从“平铺文件”改为“按 BV 聚合”

### 已完成

- `src/get-danmaku-v4.user.js` 改为统一构造分 P 视频任务
- 手动下载和收藏夹轮询都会触发全部分 P 视频下载
- 轮询弹幕改写到 `danmaku/<title>_<bvid>/` 并同名覆盖
- 轮询日志改写到 `danmaku/logs/` 并保留历史文件
- `danmaku-server.mjs` 改为按 `BV + page` 去重、校验和下载视频
- 服务端 `/save` 支持安全的多级相对目录
- 服务端 `/api/videos` 改为按 BV 聚合并返回 `parts[]`
- WebUI 改为“一张 BV 卡片 + 查看分P详情弹层”

### 遗留事项

- 还未实现 WebUI 内的弹幕叠加播放
- 目前 WebUI 仍未提供搜索、筛选和排序

### 涉及文件

- `src/get-danmaku-v4.user.js`
- `danmaku-server.mjs`
- `webui/app.js`
- `webui/style.css`
- `README.md`
- `docs/usage.md`
- `docs/architecture.md`
- `docs/service-webui-security.md`
- `TODO.md`

### 文档更新

- README 与 usage 已同步新的输出目录结构
- architecture 已补充分 P 下载任务与归档模型
- service/security 文档已同步 `/download-video` 与 `/api/videos` 的新数据形态

## 2026-03-26 文档体系整理

### 背景

README 在多轮迭代后同时承载了项目介绍、架构背景、部署说明、运维指引和历史上下文，已经偏重，不适合作为后续 AI 的唯一入口。

### 本轮目标

- 缩减 README 的体量
- 将项目文档按主题拆分
- 增加一个给 AI 使用的总入口文档
- 为后续迭代补上固定的归档位置

### 已完成

- 将 `README.md` 收敛为项目首页和文档导航
- 新增 `docs/project-overview.md`
- 新增 `docs/architecture.md`
- 新增 `docs/usage.md`
- 新增 `docs/service-webui-security.md`
- 新增 `AGENTS.md`，作为后续 AI 的首读入口
- 新增当前这份 `docs/iteration-log.md`，用于记录每轮需求迭代

### 遗留事项

- 后续每轮实际功能迭代需要持续补写该文档
- 目前历史迭代尚未完整回填，只补了本轮文档整理记录

### 涉及文件

- `README.md`
- `AGENTS.md`
- `docs/project-overview.md`
- `docs/architecture.md`
- `docs/usage.md`
- `docs/service-webui-security.md`
- `docs/iteration-log.md`

### 文档更新

- 新建文档分层结构
- 为后续 AI 协作建立统一入口

## 2026-03-25 视频下载与画质策略修复

### 背景

在视频下载链路中，存在以下核心问题：

- 某些高帧率视频被错误下载为 30 帧
- 某些 4K 视频被错误下载为 1080P
- 缺少“超过 1 GiB 自动降档”的稳定实现
- 登录态传递不稳定时会误退回游客态

### 本轮目标

- 修复视频格式选择逻辑
- 保住高帧率与高分辨率
- 支持智能大小限制
- 让服务端在前端 cookie 不稳定时也能尽可能拿到登录态

### 已完成

- 新增 `src/video-format-selector.mjs`
- 增加格式选择单测 `test/video-format-selector.test.mjs`
- 服务端改为先探测格式，再选择最优下载方案
- 同档优先保高帧率
- 同档存在预算内高质量格式时，保住 4K
- 当预计总体积超过 `1 GiB` 时自动逐档降级
- 服务端支持在必要时从本机 Chrome / Edge DevTools 读取 bilibili cookie
- 补上 `yt-dlp` 探测失败重试
- 修正“旧低画质文件直接跳过、不再升级”的问题

### 遗留事项

- 安全边界已明确，但尚未做进一步加固
- WebUI 的“视频弹幕叠加播放”仍未实现

### 涉及文件

- `danmaku-server.mjs`
- `src/get-danmaku-v4.user.js`
- `src/video-format-selector.mjs`
- `test/video-format-selector.test.mjs`
- `README.md`
- `docs/service-webui-security.md`

### 文档更新

- README 与拆分文档中已同步补充当前能力说明
- 安全文档补充了 localhost 服务与 cookie 风险面的说明
