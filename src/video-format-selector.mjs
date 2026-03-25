const ONE_GIB = 1024 ** 3;

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function getApproxFilesize(format, durationSeconds = 0) {
    const exact = toNumber(format?.filesize);
    if (exact > 0) return exact;

    const approx = toNumber(format?.filesize_approx);
    if (approx > 0) return approx;

    const duration = toNumber(durationSeconds);
    const tbr = toNumber(format?.tbr);
    if (duration > 0 && tbr > 0) {
        return Math.round((tbr * 1000 / 8) * duration);
    }

    return 0;
}

function getFps(format) {
    return toNumber(format?.fps);
}

function getHeight(format) {
    return toNumber(format?.height);
}

function getWidth(format) {
    return toNumber(format?.width);
}

function getQuality(format) {
    return toNumber(format?.quality);
}

function getDynamicRangeRank(format) {
    const dynamicRange = String(format?.dynamic_range || '').toUpperCase();
    if (dynamicRange.includes('DOLBY')) return 3;
    if (dynamicRange.includes('HDR')) return 2;
    if (dynamicRange.includes('HLG')) return 1;
    return 0;
}

function getCodecPreference(format) {
    const codec = String(format?.vcodec || '').toLowerCase();
    if (codec.includes('av01')) return 3;
    if (codec.includes('hev1') || codec.includes('hvc1')) return 2;
    if (codec.includes('avc1')) return 1;
    return 0;
}

function isVideoOnlyFormat(format) {
    return Boolean(format)
        && format.vcodec
        && format.vcodec !== 'none'
        && (!format.acodec || format.acodec === 'none');
}

function isAudioOnlyFormat(format) {
    return Boolean(format)
        && format.acodec
        && format.acodec !== 'none'
        && (!format.vcodec || format.vcodec === 'none');
}

function isProgressiveFormat(format) {
    return Boolean(format)
        && format.vcodec
        && format.vcodec !== 'none'
        && format.acodec
        && format.acodec !== 'none';
}

function getLevelKey(format) {
    return [
        getHeight(format),
        getWidth(format),
        getQuality(format),
        Math.round(getFps(format) || 0),
        getDynamicRangeRank(format),
    ].join('|');
}

function compareWithinLevel(a, b, durationSeconds = 0) {
    return compareScoreTuples(
        [
            toNumber(a?.tbr),
            getApproxFilesize(a, durationSeconds),
            getCodecPreference(a),
            getWidth(a),
            String(a?.format_id || ''),
        ],
        [
            toNumber(b?.tbr),
            getApproxFilesize(b, durationSeconds),
            getCodecPreference(b),
            getWidth(b),
            String(b?.format_id || ''),
        ],
    );
}

function compareLevel(a, b) {
    return compareScoreTuples(
        [
            getHeight(a),
            getWidth(a),
            getQuality(a),
            getFps(a),
            getDynamicRangeRank(a),
            toNumber(a?.tbr),
            getCodecPreference(a),
            String(a?.format_id || ''),
        ],
        [
            getHeight(b),
            getWidth(b),
            getQuality(b),
            getFps(b),
            getDynamicRangeRank(b),
            toNumber(b?.tbr),
            getCodecPreference(b),
            String(b?.format_id || ''),
        ],
    );
}

function compareScoreTuples(left, right) {
    for (let i = 0; i < left.length; i += 1) {
        const a = left[i];
        const b = right[i];

        if (typeof a === 'string' || typeof b === 'string') {
            const sa = String(a);
            const sb = String(b);
            if (sa > sb) return -1;
            if (sa < sb) return 1;
            continue;
        }

        if (a > b) return -1;
        if (a < b) return 1;
    }
    return 0;
}

function groupFormatsByLevel(formats, durationSeconds = 0) {
    const buckets = new Map();

    for (const format of formats) {
        const key = getLevelKey(format);
        const existing = buckets.get(key) || [];
        existing.push(format);
        buckets.set(key, existing);
    }

    return [...buckets.values()]
        .map(group => group.sort((a, b) => compareWithinLevel(a, b, durationSeconds)))
        .sort((a, b) => compareLevel(a[0], b[0]));
}

function selectBestAudioFormat(formats, durationSeconds = 0) {
    const audioFormats = formats.filter(isAudioOnlyFormat);
    if (audioFormats.length === 0) return null;

    return [...audioFormats].sort((a, b) => compareScoreTuples(
        [
            toNumber(a?.abr),
            toNumber(a?.asr),
            getApproxFilesize(a, durationSeconds),
            String(a?.format_id || ''),
        ],
        [
            toNumber(b?.abr),
            toNumber(b?.asr),
            getApproxFilesize(b, durationSeconds),
            String(b?.format_id || ''),
        ],
    ))[0];
}

function chooseFormatWithinGroup(group, maxBytes, durationSeconds = 0) {
    const underLimit = group.filter(format => getApproxFilesize(format, durationSeconds) <= maxBytes);
    return (underLimit[0] || group[0] || null);
}

function selectVideoDownloadPlan(info, options = {}) {
    const formats = Array.isArray(info?.formats) ? info.formats : [];
    const durationSeconds = toNumber(info?.duration);
    const maxBytes = toNumber(options.maxBytes, ONE_GIB);

    const audio = selectBestAudioFormat(formats, durationSeconds);
    const audioSize = audio ? getApproxFilesize(audio, durationSeconds) : 0;

    const videoGroups = groupFormatsByLevel(formats.filter(isVideoOnlyFormat), durationSeconds);
    for (let levelIndex = 0; levelIndex < videoGroups.length; levelIndex += 1) {
        const group = videoGroups[levelIndex];
        const levelBudget = Math.max(maxBytes - audioSize, 0);
        const video = chooseFormatWithinGroup(group, levelBudget, durationSeconds);
        if (!video) continue;

        const totalSize = getApproxFilesize(video, durationSeconds) + audioSize;
        if (totalSize <= maxBytes || levelIndex === videoGroups.length - 1) {
            return {
                type: 'adaptive',
                formatId: audio ? `${video.format_id}+${audio.format_id}` : String(video.format_id),
                video,
                audio,
                estimatedSize: totalSize,
                downgradeCount: levelIndex,
                maxBytes,
                usedFallbackSize: getApproxFilesize(video, durationSeconds) === 0,
            };
        }
    }

    const progressiveGroups = groupFormatsByLevel(formats.filter(isProgressiveFormat), durationSeconds);
    for (let levelIndex = 0; levelIndex < progressiveGroups.length; levelIndex += 1) {
        const group = progressiveGroups[levelIndex];
        const progressive = chooseFormatWithinGroup(group, maxBytes, durationSeconds);
        if (!progressive) continue;

        const totalSize = getApproxFilesize(progressive, durationSeconds);
        if (totalSize <= maxBytes || levelIndex === progressiveGroups.length - 1) {
            return {
                type: 'progressive',
                formatId: String(progressive.format_id),
                video: progressive,
                audio: null,
                estimatedSize: totalSize,
                downgradeCount: levelIndex,
                maxBytes,
                usedFallbackSize: totalSize === 0,
            };
        }
    }

    return null;
}

function summarizeSelectedFormat(plan) {
    if (!plan?.video) return null;

    return {
        formatId: plan.formatId,
        type: plan.type,
        height: getHeight(plan.video),
        width: getWidth(plan.video),
        fps: getFps(plan.video),
        quality: getQuality(plan.video),
        dynamicRange: plan.video.dynamic_range || 'SDR',
        videoCodec: plan.video.vcodec || '',
        audioCodec: plan.audio?.acodec || plan.video.acodec || '',
        estimatedSize: plan.estimatedSize,
        downgradeCount: plan.downgradeCount,
    };
}

export {
    ONE_GIB,
    getApproxFilesize,
    groupFormatsByLevel,
    isAudioOnlyFormat,
    isProgressiveFormat,
    isVideoOnlyFormat,
    selectBestAudioFormat,
    selectVideoDownloadPlan,
    summarizeSelectedFormat,
};
