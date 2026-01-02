# Bilibili 弹幕下载器

下载 B 站视频弹幕的命令行工具，支持单个视频和多 P 视频的弹幕下载。

## 功能特性

- ✅ 支持通过 BV 号下载弹幕
- ✅ 自动获取视频标题作为文件名
- ✅ 支持多 P 视频分集下载
- ✅ 支持多 P 弹幕合并下载
- ✅ 输出标准 B 站 XML 格式弹幕文件

## 环境要求

- Node.js >= 14.0

## 使用方法

### 基础版 (单 P 视频)

```bash
node src/get-danmaku.js BV1xx411c7mD
```

### 进阶版 (多 P 视频)

**分 P 下载 (默认模式)**
```bash
node src/get-danmaku-v2.js BV1xx411c7mD
```

**合并下载**
```bash
node src/get-danmaku-v2.js BV1xx411c7mD --merge
# 或
node src/get-danmaku-v2.js BV1xx411c7mD -m
```

## 输出文件

- 基础版: `视频标题_BV号.xml`
- 进阶版 (分 P): `视频标题_P1_分集名_BV号.xml`
- 进阶版 (合并): `视频标题_[全集合并]_BV号.xml`

## License

MIT
