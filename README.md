# Bilibili 弹幕下载器

一个用于缓存 B 站弹幕与视频到本地的项目，包含命令行脚本、Tampermonkey 油猴脚本、本地 Node.js 服务和 WebUI。

当前推荐使用 `v4` 方案：
- 浏览器侧负责读取 B 站页面、收藏夹与弹幕数据
- 本地服务负责写文件、下载视频、提供 WebUI
- WebUI 用于浏览本地视频库、播放视频、打开所属文件夹

## 当前能力

- 下载单个视频或多 P 视频的弹幕
- 收藏夹轮询将弹幕更新到固定目录并同名覆盖
- 多 P 视频按分 P 全量下载到本地并记录元数据
- WebUI 按 BV 聚合展示视频卡片，并可按时间排序、按 UP 主筛选
- WebUI 可展开播放各分 P，并支持跳转 B 站页面 / UP 主空间 / 在资源管理器中选中视频或弹幕文件
- 智能格式选择
  - 同档优先高帧率
  - 能保住 4K 就不降到 1080P
  - 预计体积超过 `1 GiB` 时自动降档

## 版本入口

| 版本 | 文件 | 说明 |
|:---|:---|:---|
| v1 基础版 | `src/get-danmaku.js` | 命令行，适用于单 P 视频 |
| v2 进阶版 | `src/get-danmaku-v2.js` | 命令行，支持多 P 与合并下载 |
| v3 油猴版 | `src/get-danmaku-v3.user.js` | 浏览器脚本，下载到浏览器默认下载目录 |
| v4 本地服务版 | `src/get-danmaku-v4.user.js` + `danmaku-server.mjs` | 推荐方案，支持固定目录覆盖、分 P 视频下载、WebUI、同名覆盖 |

## 快速开始

### 命令行

```bash
node src/get-danmaku.js BV1xx411c7mD
node src/get-danmaku-v2.js BV1xx411c7mD
node src/get-danmaku-v2.js BV1xx411c7mD --merge
```

### v4 推荐方案

1. 启动本地服务

```powershell
node danmaku-server.mjs
```

2. 在 Tampermonkey 中安装 `src/get-danmaku-v4.user.js`
3. 打开任意 B 站视频页
4. 通过悬浮面板手动下载，或配置收藏夹轮询
5. 打开 `http://127.0.0.1:18888/webui` 查看本地库

## 文档导航

- 项目概览与版本关系：[`docs/project-overview.md`](docs/project-overview.md)
- 架构与关键设计：[`docs/architecture.md`](docs/architecture.md)
- 使用说明与部署：[`docs/usage.md`](docs/usage.md)
- WebUI、接口与安全说明：[`docs/service-webui-security.md`](docs/service-webui-security.md)
- 需求迭代记录：[`docs/iteration-log.md`](docs/iteration-log.md)
- 待办与后续需求：[`TODO.md`](TODO.md)
- AI 协作入口：[`AGENTS.md`](AGENTS.md)

## License

MIT
