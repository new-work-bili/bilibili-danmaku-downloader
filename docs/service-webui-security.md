# 本地服务、WebUI 与安全说明

## 本地服务职责

`danmaku-server.mjs` 当前提供以下能力：

- `GET /health`
  - 健康检查
- `POST /save`
  - 在 `BASE_DIR` 内按安全相对路径保存 XML 或日志文件
- `POST /download-video`
  - 按 `BV + page` 粒度后台调用 `yt-dlp` 下载视频并记录元数据
- `GET /api/videos`
  - 返回按 BV 聚合后的本地视频库列表
- `GET /api/download-blacklist`
  - 返回当前已进入黑名单的失效视频列表
- `POST /api/download-blacklist/report`
  - 记录一次失效 / 不可访问命中并累计次数
- `POST /api/download-blacklist/remove`
  - 手动移除某个 BV 的黑名单状态
- `POST /api/download-blacklist/mark`
  - 手动把某个 BV 直接加入黑名单
- `POST /api/open-folder`
  - 打开本机文件夹，并可选中对应视频或弹幕文件
- `GET /files/*`
  - 读取已下载的本地文件
- `GET /webui`
  - 提供 WebUI 页面

## WebUI 当前能力

WebUI 入口：

```text
http://127.0.0.1:18888/webui
```

当前支持：

- 读取本地视频库
- 以 BV 卡片形式展示视频
- 显示添加收藏时间、更新弹幕时间、视频发布时间
- 按收藏时间 / 弹幕更新时间 / 发布时间排序
- 按 UP 主筛选
- 按状态筛选“全部视频 / 仅黑名单 / 排除黑名单”
- 将黑名单视频直接混排到主视频流卡片中，并保留统一卡片样式
- 在卡片和详情弹层中直接把视频加入黑名单或移出黑名单
- 在详情弹层中显示失效原因、命中次数、最近来源、首次 / 最近发现时间与错误摘要
- 在详情弹层中提供原视频页和 UP 主空间的外链跳转
- 手动将黑名单中的 BV 恢复到后续轮询队列
- 跳转到对应视频的 B 站页面
- 点击 UP 主跳转到空间页
- 通过详情弹层查看分 P 列表
- 播放指定分 P 的本地视频
- 打开所属文件夹并选中视频文件
- 选中对应弹幕 XML 文件

当前暂未实现：

- 视频弹幕叠加播放
- 关键词搜索

## 视频下载链路

### 登录态来源

优先顺序如下：

1. 油猴脚本通过 `GM_cookie` 读取到的 bilibili cookie
2. 如果前端未带到有效登录态，服务端尝试从本机 Chrome / Edge DevTools 调试口读取 bilibili cookie
3. 如果仍然拿不到，则降级为游客态

### 体积与画质策略

核心逻辑在 `src/video-format-selector.mjs`。

规则：

- 默认上限为 `1 GiB`
- 同档优先保高帧率
- 同档内若有更省体积的编码，则优先选预算内的最佳项
- 当前档全部超预算时，才降到下一档

这也是为什么某些视频最终接近 `0.98 GiB`，但分辨率和帧率没有变化。

### 任务粒度

当前 `POST /download-video` 依赖这些前端字段：

- `metadata.bvid`
- `metadata.page`
- `metadata.partTitle`
- `metadata.groupDir`
- `filename`

服务端会把每个分 P 视为独立下载任务：

- 重复下载判定按 `BV + page`
- 同目录内画质校验也按单个分 P 进行
- cookie 临时文件名会带上分 P 任务标识，避免同 BV 多任务互相覆盖
- 如果该 `BV` 已进入黑名单，则会在启动 `yt-dlp` 前直接返回 `skipped + blacklisted`

### 黑名单状态来源

服务端当前把以下情况视为“明确不可用”：

1. 收藏夹接口直接标记为失效 / 下架
2. `view` 接口明确返回资源不存在或不可访问
3. `yt-dlp` 明确返回 404 / unavailable 类错误

状态按 `bvid` 维度保存在：

- `BASE_DIR/state/download-blacklist.json`

当前策略：

- 每次命中累加一次
- 默认阈值 `5`
- 达到阈值后变为 `blacklisted`
- `/api/download-blacklist` 只返回 `blacklisted` 条目
- `/api/videos` 会把这些黑名单条目合并回主视频卡片流
- 手动移除后计数归零，下次轮询重新开始累计

## 安全边界

### 目前没有主动上传到第三方云端的逻辑

按当前代码，账号相关信息主要只在以下边界内流动：

- 浏览器中的 Tampermonkey 脚本
- 本机 `127.0.0.1` 本地服务
- 本机 `yt-dlp`
- B 站自身接口

代码中没有把 bilibili cookie 主动上传到外部第三方服务的逻辑。

## 当前仍然存在的风险面

### 1. localhost 接口暴露面偏宽

服务当前只监听 `127.0.0.1`，这是一个正向约束；但同时 CORS 允许较宽，意味着本机浏览器中的其他网页理论上有机会探测或调用本地服务。

需要重点关注的接口：

- `/api/videos`
- `/api/download-blacklist`
- `/api/download-blacklist/report`
- `/api/download-blacklist/remove`
- `/api/download-blacklist/mark`
- `/files/*`
- `/api/open-folder`

### 2. cookie 临时文件残留风险

服务会把 cookie 写入临时的 Netscape cookie 文件供 `yt-dlp` 使用。正常流程下会删除，但如果进程异常终止，可能留下一些 `.cookies_*.txt` 临时文件。

### 3. WebUI 对本地文件的读取能力

WebUI 依赖 `/files/*` 访问本地视频和 XML，这让使用体验更好，但同时也意味着本地服务本身具有文件暴露能力，维护时必须谨慎扩展。

当前聚合规则：

- 视频从 `BASE_DIR/videos/<groupDir>/` 下扫描 `.info.json`
- 弹幕从 `BASE_DIR/danmaku/<groupDir>/` 下匹配同名 XML
- `/api/videos` 返回的是“一个 BV 一张卡 + parts[]”的数据结构
- 卡片层会额外聚合 `favoriteTime / publishTime / updateTime / uploaderMid / primaryVideoPath / primaryDanmakuPath`

## 后续如果要继续加固，优先方向

- 为本地服务增加随机 token 或鉴权头
- 收紧 CORS
- 对 `/files/*` 和 `/api/*` 增加更严格的访问控制
- 更明确地区分“前端页面可读接口”和“仅油猴脚本使用接口”

## 排障建议

### 画质异常

先检查：

- 服务是否重启到了最新代码
- 油猴脚本是否也更新到了最新代码
- 服务日志里是否显示拿到了登录态
- 服务日志里最终选择了哪个 `formatId`

### WebUI 打不开

先检查：

- `danmaku-server.mjs` 是否在运行
- 端口是否和 `SERVER_URL` 一致
- 直接访问 `/health` 是否返回 `ok: true`

### 视频库为空

先检查：

- 是否已经实际下载过视频
- `BASE_DIR/videos/<title>_<bvid>/` 下是否存在 `.info.json`
- `BASE_DIR/danmaku/<title>_<bvid>/` 下是否存在对应 XML
- `/api/videos` 是否有返回数据
