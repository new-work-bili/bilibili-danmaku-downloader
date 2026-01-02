#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// 输出目录：项目目录同级的"弹幕文件夹"
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(path.dirname(projectRoot), '弹幕文件夹');

// --- 命令行参数解析 ---
const args = process.argv.slice(2);
const bvId = args.find(arg => arg.startsWith('BV'));
const isMerge = args.includes('--merge') || args.includes('-m');

if (!bvId) {
    console.error('❌ 错误: 未找到 BV 号。');
    console.log('👉 用法 1 (分开下载): node get-danmaku-pro.js BV1xx411c7mD');
    console.log('👉 用法 2 (合并文件): node get-danmaku-pro.js BV1xx411c7mD --merge');
    process.exit(1);
}

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Accept-Encoding': 'gzip'
};

function sanitizeFilename(name) {
    // 替换非法字符为下划线
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') stream = res.pipe(zlib.createGunzip());
            else if (res.headers['content-encoding'] === 'deflate') stream = res.pipe(zlib.createInflateRaw());

            let data = '';
            stream.on('data', chunk => data += chunk);
            stream.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
            stream.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * 获取 XML 文本内容
 */
function fetchXmlContent(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));

            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') stream = res.pipe(zlib.createGunzip());
            else if (res.headers['content-encoding'] === 'deflate') stream = res.pipe(zlib.createInflateRaw());

            let data = '';
            stream.on('data', chunk => data += chunk);
            stream.on('end', () => resolve(data));
            stream.on('error', reject);
        }).on('error', reject);
    });
}

(async () => {
    try {
        // 确保输出目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            console.log(`� 创建目录: ${outputDir}`);
        }

        console.log(`�🔍 正在获取视频列表: ${bvId} ...`);

        const viewData = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
        if (viewData.code !== 0) throw new Error(viewData.message);

        const mainTitle = sanitizeFilename(viewData.data.title);
        const pages = viewData.data.pages;

        console.log(`✅ 视频名称: ${mainTitle}`);
        console.log(`📊 共发现 ${pages.length} 个分P。当前模式: \x1b[33m${isMerge ? '合并到一个文件' : '每个分P单独保存'}\x1b[0m`);

        // --- 模式 A: 合并下载 ---
        if (isMerge) {
            console.log(`🔄 正在并行下载所有分P弹幕并合并...`);

            const tasks = pages.map(page => {
                const url = `https://comment.bilibili.com/${page.cid}.xml`;
                return fetchXmlContent(url).then(content => ({
                    cid: page.cid,
                    content: content
                })).catch(err => {
                    console.error(`⚠️ P${page.page} 下载失败: ${err.message}`);
                    return null;
                });
            });

            const results = await Promise.all(tasks);

            let allDanmaku = [];
            results.forEach(res => {
                if (res && res.content) {
                    const matches = res.content.match(/<d p=".*?">.*?<\/d>/g);
                    if (matches) allDanmaku.push(...matches);
                }
            });

            const mergedXml = `<?xml version="1.0" encoding="UTF-8"?>
<i>
    <chatserver>chat.bilibili.com</chatserver>
    <chatid>${pages[0].cid}</chatid>
    <mission>0</mission>
    <source>k-v</source>
    ${allDanmaku.join('\n    ')}
</i>`;

            // 合并模式的文件名也加上了 BV 号
            const fileName = `${mainTitle}_[全集合并]_${bvId}.xml`;
            const filePath = path.join(outputDir, fileName);
            fs.writeFileSync(filePath, mergedXml);
            console.log(`🎉 合并完成！已保存: \x1b[32m${filePath}\x1b[0m (共 ${allDanmaku.length} 条弹幕)`);

        }
        // --- 模式 B: 分开下载 (默认) ---
        else {
            console.log(`⬇️  开始逐个下载...`);

            for (const page of pages) {
                const cid = page.cid;
                const partName = sanitizeFilename(page.part);

                // --- 修正处：文件名加上了 BV 号 ---
                // 格式: 标题_P1_分集名_BV号.xml
                const fileName = `${mainTitle}_P${page.page}_${partName}_${bvId}.xml`;
                const filePath = path.join(outputDir, fileName);

                const url = `https://comment.bilibili.com/${cid}.xml`;

                try {
                    const content = await fetchXmlContent(url);
                    fs.writeFileSync(filePath, content);
                    console.log(`   [P${page.page}] ${filePath} ✅`);
                } catch (err) {
                    console.error(`   [P${page.page}] 下载失败 ❌: ${err.message}`);
                }
            }
            console.log(`🎉 所有分P下载完成！`);
        }

    } catch (error) {
        console.error(`❌ 程序出错:`, error.message);
    }
})();