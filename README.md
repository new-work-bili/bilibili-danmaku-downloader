# Bilibili 弹幕下载器

下载 B 站视频弹幕的工具，支持命令行和浏览器油猴脚本两种使用方式。

## 版本说明

| 版本 | 文件 | 说明 |
|:---|:---|:---|
| v1 基础版 | `src/get-danmaku.js` | 命令行工具，适用于单 P 视频 |
| v2 进阶版 | `src/get-danmaku-v2.js` | 命令行工具，支持多 P + 合并下载 |
| v3 油猴版 | `src/get-danmaku-v3.user.js` | 浏览器油猴脚本，下载至浏览器默认下载目录 |
| **v4 本地服务版** | `src/get-danmaku-v4.user.js` + `danmaku-server.mjs` | 油猴脚本 + Node.js 本地服务，支持自定义目录、子文件夹、同名覆盖 |

---

## 命令行版（v1 / v2）

**环境要求**: Node.js >= 14.0

```bash
# v1：单 P 视频
node src/get-danmaku.js BV1xx411c7mD

# v2：多 P 分集下载（默认）
node src/get-danmaku-v2.js BV1xx411c7mD

# v2：多 P 合并下载
node src/get-danmaku-v2.js BV1xx411c7mD --merge
```

---

## 油猴脚本版（v3）

在浏览器中直接使用，文件下载至浏览器默认下载目录。

**安装步骤：**
1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 在 Tampermonkey 中新建脚本，粘贴 `src/get-danmaku-v3.user.js` 内容
3. 打开任意 B 站页面，右下角出现粉色悬浮按钮，点击打开下载面板

**功能：**
- 🎯 手动下载当前视频弹幕（逐 P 或合并）
- 📂 收藏夹自动轮询（每 6 小时自动下载收藏夹内所有视频弹幕）
- 📋 下载日志（最多 500 条）
- 🔧 多标签页调度锁（同一时刻只有一个标签页作为主控）

**多标签页防重复机制：**
- **调度锁（Lease-based）**：主控标签页每 5 分钟续期时间戳，后续加载的标签页检测到 2 分钟内有有效续期则放弃竞争
- **轮询互斥锁**：通过 `GM_setValue` 的 `POLL_RUNNING` 键做全局互斥，防止并发执行轮询

> ⚠️ 自动轮询需至少保持一个 B 站标签页打开。每次轮询结束后会下载一个 `轮询日志_年-月-日_时-分.txt` 文件至下载目录。

---

## 本地服务版（v4）推荐

v4 在 v3 基础上增加了 Node.js 本地服务（`danmaku-server.mjs`），解除浏览器下载限制，支持：
- ✅ 自定义保存目录（不依赖浏览器下载文件夹）
- ✅ 每次轮询自动创建时间戳子文件夹（`弹幕根目录/2026-03-14_21-15/`）
- ✅ 同名文件直接覆盖（不产生 `(1)` 等后缀）
- ✅ 服务不可用时自动降级为浏览器内置下载

### 第一步：配置保存目录

编辑 `danmaku-server.mjs`，修改以下变量：

```javascript
const PORT = 18888;      // 本地监听端口，一般无需修改
const BASE_DIR = process.env.DANMAKU_DIR
    || 'F:\\下载\\Chrome\\弹幕';  // ← 修改为你的保存目录
```

也可通过环境变量临时覆盖（优先级更高）：

```powershell
$env:DANMAKU_DIR = "D:\Danmaku" ; node danmaku-server.mjs
```

### 第二步：安装油猴脚本

在 Tampermonkey 中新建脚本，粘贴 `src/get-danmaku-v4.user.js` 内容并保存。

> ⚠️ v3 和 v4 **不要同时启用**，否则会触发重复轮询。

### 第三步：启动服务（手动）

```powershell
node danmaku-server.mjs
```

启动成功后控制台输出：
```
╔════════════════════════════════════════╗
║   Bilibili 弹幕下载服务 已启动          ║
╠════════════════════════════════════════╣
║  端口:  http://127.0.0.1:18888         ║
║  目录:  F:\下载\Chrome\弹幕             ║
╚════════════════════════════════════════╝
```

打开 B 站后，面板诊断栏会显示 **🟢 本地服务已连接**。

### 第四步：设置开机自启（PM2）

```powershell
# 全局安装 PM2（只需一次）
npm install -g pm2 pm2-windows-startup

# 注册 Windows 开机启动项（只需一次）
pm2-startup install

# 将服务交由 PM2 管理并启动
pm2 start danmaku-server.mjs --name danmaku-server

# 保存当前进程列表，下次开机自动恢复
pm2 save
```

### PM2 日常管理命令

```powershell
pm2 status                      # 查看所有进程的运行状态
pm2 logs danmaku-server         # 实时查看服务日志（Ctrl+C 退出）
pm2 logs danmaku-server --lines 50  # 查看最近 50 条日志

pm2 restart danmaku-server      # 重启（修改 danmaku-server.mjs 后执行）
pm2 stop danmaku-server         # 临时停止（不删除进程）
pm2 start danmaku-server        # 重新启动已停止的进程

pm2 delete danmaku-server       # 从 PM2 中彻底移除该进程
pm2 save                        # 保存当前进程列表（delete 后需再次 save 才能生效）

pm2-startup uninstall           # 取消 Windows 开机自启注册
```

### 可配置变量

| 位置 | 变量 | 默认值 | 说明 |
|:---|:---|:---|:---|
| `danmaku-server.mjs` | `PORT` | `18888` | 本地监听端口，如与其他服务冲突可更改。修改后需同步修改 v4 脚本中的 `SERVER_URL` |
| `danmaku-server.mjs` | `BASE_DIR` | — | 弹幕文件保存根目录，直接在代码中修改或通过 `$env:DANMAKU_DIR` 环境变量覆盖 |
| `get-danmaku-v4.user.js` | `SERVER_URL` | `http://127.0.0.1:18888` | 本地服务地址，只有修改了 `PORT` 时才需要同步修改 |
| `get-danmaku-v4.user.js` | `POLL_INTERVAL_MS` | `6 * 60 * 60 * 1000`（6小时） | 自动轮询间隔，单位毫秒 |

---

## 输出文件结构

**v3（浏览器下载目录）：**
```
Downloads/
├── 视频标题_[全集合并]_BV1xxx.xml
└── 轮询日志_2026-03-14_21-15.txt
```

**v4（本地服务，含子文件夹）：**
```
BASE_DIR/
└── 2026-03-14_21-15/         ← 每次轮询自动创建
    ├── 视频标题A_[全集合并]_BV1xxx.xml
    ├── 视频标题B_[全集合并]_BV1yyy.xml
    └── 轮询日志_2026-03-14_21-15.txt
```

**文件命名规则：**
- 命令行分 P：`视频标题_P1_分集名_BV号.xml`
- 命令行 / 油猴合并：`视频标题_[全集合并]_BV号.xml`

---

## License

MIT
