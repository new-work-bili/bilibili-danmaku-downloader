# 使用说明

## 环境要求

- Node.js `>= 14`
- Windows 环境下推荐配合 PowerShell 使用
- 如果要下载视频，需要本机可用的 `yt-dlp`
- 如果要使用油猴脚本，需要安装 Tampermonkey

## 命令行用法

### v1 单 P

```bash
node src/get-danmaku.js BV1xx411c7mD
```

### v2 多 P

```bash
node src/get-danmaku-v2.js BV1xx411c7mD
```

### v2 多 P 合并

```bash
node src/get-danmaku-v2.js BV1xx411c7mD --merge
```

## v3 油猴版

适合希望直接在浏览器里用、且不需要本地服务的人。

### 安装步骤

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 新建脚本并粘贴 `src/get-danmaku-v3.user.js`
3. 打开 B 站页面，右下角会出现悬浮面板

### 主要能力

- 手动下载当前视频弹幕
- 合并多 P 弹幕
- 收藏夹定时轮询
- 下载日志
- 多标签页防重复

### 限制

- 文件保存到浏览器默认下载目录
- 无法稳定控制子文件夹
- 无法稳定同名覆盖
- 不提供本地视频库 WebUI

## v4 本地服务版

这是当前推荐方案。

### 能力

- 自定义保存目录
- 弹幕、视频、元数据统一归档
- 多 P 视频按分 P 全量下载
- 轮询弹幕写入固定目录并同名覆盖
- 支持本地视频下载
- 支持 WebUI
- 支持同名覆盖
- 服务不可用时自动降级为浏览器下载弹幕

### 第一步：启动服务

```powershell
node danmaku-server.mjs
```

也可以临时覆盖目录或端口：

```powershell
$env:DANMAKU_DIR = "D:\Danmaku"
$env:DANMAKU_PORT = "18888"
node danmaku-server.mjs
```

如果需要自定义 `yt-dlp`：

```powershell
$env:YT_DLP_BIN = "yt-dlp"
node danmaku-server.mjs
```

### 第二步：安装 v4 油猴脚本

1. 在 Tampermonkey 新建脚本
2. 粘贴 `src/get-danmaku-v4.user.js`
3. 保存并刷新 B 站页面

注意：

- `v3` 和 `v4` 不要同时启用
- v4 面板诊断区域显示“本地服务已连接”后再使用完整能力

### 第三步：使用方式

- 手动下载当前视频的分 P 弹幕
- 手动合并多 P 弹幕，同时仍会触发全部分 P 视频下载
- 自动触发对应视频的全部分 P 下载
- 配置收藏夹 ID 并开启轮询

### WebUI

服务启动后可访问：

```text
http://127.0.0.1:18888/webui
```

当前 WebUI 支持：

- 按 BV 查看本地视频卡片列表
- 显示封面、标题、UP 主、下载时间与总 P 数
- 通过“查看分P”详情弹层浏览并播放指定分 P
- 打开视频所属文件夹

## PM2 开机自启

```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install
pm2 start danmaku-server.mjs --name danmaku-server
pm2 save
```

常用命令：

```powershell
pm2 status
pm2 logs danmaku-server
pm2 restart danmaku-server
pm2 stop danmaku-server
pm2 delete danmaku-server
pm2 save
```

## 输出结构

### v3

```text
Downloads/
├── 视频标题_[全集合并]_BV1xxx.xml
└── 轮询日志_2026-03-14_21-15.txt
```

### v4

```text
BASE_DIR/
├── danmaku/
│   ├── 视频标题_BV1xxx/
│   │   ├── 视频标题_P1_片头_BV1xxx.xml
│   │   ├── 视频标题_P2_正片_BV1xxx.xml
│   │   └── 视频标题_[全集合并]_BV1xxx.xml
│   └── logs/
│       ├── 轮询日志_2026-03-26_09-00.txt
│       └── 轮询日志_2026-03-26_15-00.txt
└── videos/
    └── 视频标题_BV1xxx/
        ├── 视频标题_P1_片头_BV1xxx.mp4
        ├── 视频标题_P1_片头_BV1xxx.info.json
        ├── 视频标题_P2_正片_BV1xxx.mp4
        └── 视频标题_P2_正片_BV1xxx.info.json
```

说明：

- 收藏夹轮询默认更新 `danmaku/<视频标题_BVID>/` 下的分 P XML
- 后续轮询会直接覆盖同名 XML，不再新增时间戳弹幕目录
- `danmaku/logs/` 下保留每次轮询的历史日志文件

## 常见操作

### 修改保存目录

- 改 `danmaku-server.mjs` 里的 `BASE_DIR`
- 或使用环境变量 `DANMAKU_DIR`

### 修改监听端口

- 设置 `DANMAKU_PORT`
- 同步修改 `src/get-danmaku-v4.user.js` 里的 `SERVER_URL`

### 修改轮询间隔

- 修改 `src/get-danmaku-v4.user.js` 中的 `POLL_INTERVAL_MS`

## 测试与验证

当前已有的格式选择单测：

```bash
node --test test/video-format-selector.test.mjs
```

如果修改了服务端，建议至少补做：

- `node --check danmaku-server.mjs`
- `node --check src/get-danmaku-v4.user.js`
- `node --check webui/app.js`
- 手动打开一次 `/webui`
- 实测一次视频下载
