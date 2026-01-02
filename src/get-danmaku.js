#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// 获取命令行输入的 BV 号
const bvId = process.argv[2];

if (!bvId || !bvId.startsWith('BV')) {
    console.error('❌ 错误: 请提供正确的 BV 号。');
    console.log('👉 用法: node get-danmaku-plus.js BV1xx411c7mD');
    process.exit(1);
}

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Accept-Encoding': 'gzip'
};

/**
 * 净化文件名
 */
function sanitizeFilename(name) {
    // Windows/Unix 非法字符替换为下划线
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (res.headers['content-encoding'] === 'deflate') {
                stream = res.pipe(zlib.createInflateRaw());
            }

            let data = '';
            stream.on('data', (chunk) => data += chunk);
            stream.on('end', () => {
                try {
                    if (!data.trim()) return reject(new Error('API 返回为空'));
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
            stream.on('error', reject);
        }).on('error', reject);
    });
}

function downloadXml(url, filename) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        
        https.get(url, { headers }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`下载失败，状态码: ${res.statusCode}`));
                return;
            }

            const encoding = res.headers['content-encoding'];
            let stream = res;

            if (encoding === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (encoding === 'deflate') {
                stream = res.pipe(zlib.createInflateRaw());
            }
            
            stream.on('error', (err) => {
                console.error('⚠️ 解压流发生错误:', err.message);
                file.close();
                fs.unlink(filename, () => {});
                reject(err);
            });

            stream.pipe(file);

            file.on('finish', () => {
                file.close(() => resolve(filename));
            });
        }).on('error', (err) => {
            fs.unlink(filename, () => {});
            reject(err);
        });
    });
}

(async () => {
    try {
        console.log(`🔍 正在获取视频详情: ${bvId} ...`);
        
        const viewData = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
        
        if (viewData.code !== 0 || !viewData.data) {
            throw new Error(`无法获取视频信息。API返回: ${viewData.message}`);
        }

        const mainTitle = viewData.data.title;
        const firstPage = viewData.data.pages[0];
        const cid = firstPage.cid;

        // --- 核心修改点 ---
        const safeTitle = sanitizeFilename(mainTitle);
        // 文件名格式：标题_BV号.xml
        const fileName = `${safeTitle}_${bvId}.xml`;
        
        console.log(`✅ 获取成功!`);
        console.log(`   标题: ${mainTitle}`);
        console.log(`   CID:  ${cid}`);
        console.log(`   保存为: ${fileName}`);

        const xmlUrl = `https://comment.bilibili.com/${cid}.xml`;

        console.log(`⬇️  开始下载...`);
        await downloadXml(xmlUrl, fileName);
        
        console.log(`🎉 成功！文件位于: \x1b[32m${path.resolve(fileName)}\x1b[0m`);

    } catch (error) {
        console.error(`❌ 发生错误:`, error.message);
    }
})();