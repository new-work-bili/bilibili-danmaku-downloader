/**
 * danmaku-server.mjs
 * Bilibili 弹幕下载器 - 本地文件写入服务（配合 get-danmaku-v4.user.js 使用）
 *
 * 启动方式:  node danmaku-server.mjs
 * 自定义保存目录: $env:DANMAKU_DIR="D:\MyDanmaku" ; node danmaku-server.mjs
 *
 * API:
 *   GET  /health  → { ok, baseDir }
 *   POST /save    → body: { folder?, filename, content }  →  { ok, path }
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 18888;
const BASE_DIR = process.env.DANMAKU_DIR
    || 'F:\\下载\\Chrome\\弹幕';   // ← 在此修改你的默认保存目录


// 确保根目录存在
fs.mkdirSync(BASE_DIR, { recursive: true });

// ──────────────────────────────────────────────
const server = http.createServer((req, res) => {

    // CORS - 允许浏览器扩展/油猴脚本跨域调用
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ── 健康检查 ──────────────────────────────
    if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { ok: true, baseDir: BASE_DIR });
        return;
    }

    // ── 保存文件 ──────────────────────────────
    if (req.method === 'POST' && req.url === '/save') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            try {
                const { folder = '', filename, content } = JSON.parse(body);

                if (!filename) throw new Error('filename 不能为空');

                // 路径安全检查：禁止路径穿越
                const safeFolder = folder.replace(/\.\./g, '_');
                const safeFilename = path.basename(filename); // 只取文件名部分
                const targetDir = safeFolder
                    ? path.join(BASE_DIR, safeFolder)
                    : BASE_DIR;

                fs.mkdirSync(targetDir, { recursive: true });

                const filePath = path.join(targetDir, safeFilename);
                fs.writeFileSync(filePath, content, 'utf-8');

                console.log(`[✅ 已保存] ${filePath}`);
                json(res, 200, { ok: true, path: filePath });

            } catch (err) {
                console.error(`[❌ 保存失败]`, err.message);
                json(res, 500, { ok: false, error: err.message });
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

// ──────────────────────────────────────────────
function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

server.listen(PORT, '127.0.0.1', () => {
    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║   Bilibili 弹幕下载服务 已启动          ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║  端口:  http://127.0.0.1:${PORT}         ║`);
    console.log(`║  目录:  ${BASE_DIR.padEnd(30)} ║`);
    console.log(`╚════════════════════════════════════════╝`);
});
