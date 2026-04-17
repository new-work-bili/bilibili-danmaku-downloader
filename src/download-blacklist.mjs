export const DOWNLOAD_BLACKLIST_THRESHOLD = 5;
export const DOWNLOAD_BLACKLIST_STATE_VERSION = 1;

const FAVORITE_INVALID_REASON_CODE = 'favorite-invalid';
const MANUAL_BLACKLIST_REASON_CODE = 'manual-blacklist';
const RESOURCE_UNAVAILABLE_REASON_CODE = 'resource-unavailable';

const DEFAULT_REASON_TEXT = {
    [FAVORITE_INVALID_REASON_CODE]: '收藏夹条目已失效或下架',
    [MANUAL_BLACKLIST_REASON_CODE]: '手动加入黑名单',
    [RESOURCE_UNAVAILABLE_REASON_CODE]: '资源不存在或不可访问',
};

const VIEW_UNAVAILABLE_PATTERNS = [
    /稿件不存在/i,
    /视频不存在/i,
    /啥都木有/i,
    /已失效/i,
    /已下架/i,
    /已删除/i,
    /不存在或已删除/i,
    /资源不存在/i,
    /无法访问/i,
    /不可访问/i,
    /审核中/i,
    /仅UP主自己可见/i,
];

const YT_DLP_UNAVAILABLE_PATTERNS = [
    /http error 404/i,
    /requested format is not available/i,
    /video has been removed/i,
    /video is unavailable/i,
    /this video is unavailable/i,
    /is not available in your region/i,
    /content is unavailable/i,
    /unable to download.*not available/i,
    /该视频已失效/i,
    /已下架/i,
    /已删除/i,
    /资源不存在/i,
    /无法访问/i,
    /不可访问/i,
];

function normalizeTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric < 1e12 ? numeric * 1000 : numeric;
}

function normalizeNonEmptyString(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function normalizeBvidLookupKey(value) {
    return normalizeNonEmptyString(value).toUpperCase();
}

function normalizeSource(source) {
    const value = normalizeNonEmptyString(source);
    if (value === 'favorites-api' || value === 'view-api' || value === 'yt-dlp' || value === 'manual') {
        return value;
    }
    return 'favorites-api';
}

function normalizeUploaderMid(value) {
    const normalized = normalizeNonEmptyString(value);
    return normalized.replace(/[^\d]/g, '') || '';
}

function matchPatterns(value, patterns) {
    const text = normalizeNonEmptyString(value);
    if (!text) return false;
    return patterns.some(pattern => pattern.test(text));
}

export function isUnavailableViewMessage(message, code = null) {
    const numericCode = Number(code);
    if (numericCode === -404 || numericCode === 62002) {
        return true;
    }
    return matchPatterns(message, VIEW_UNAVAILABLE_PATTERNS);
}

export function isUnavailableYtDlpMessage(message) {
    return matchPatterns(message, YT_DLP_UNAVAILABLE_PATTERNS);
}

export function normalizeBlacklistReason({ reasonCode, reasonText, message } = {}) {
    const normalizedCode = normalizeNonEmptyString(reasonCode);
    const normalizedText = normalizeNonEmptyString(reasonText);
    const normalizedMessage = normalizeNonEmptyString(message);

    if (
        normalizedCode === FAVORITE_INVALID_REASON_CODE
        || normalizedCode === 'favorite_invalid'
        || normalizedCode === 'favorite_removed'
    ) {
        return {
            reasonCode: FAVORITE_INVALID_REASON_CODE,
            reasonText: normalizedText || DEFAULT_REASON_TEXT[FAVORITE_INVALID_REASON_CODE],
        };
    }

    if (
        normalizedCode === MANUAL_BLACKLIST_REASON_CODE
        || normalizedCode === 'manual_blacklist'
    ) {
        return {
            reasonCode: MANUAL_BLACKLIST_REASON_CODE,
            reasonText: normalizedText || DEFAULT_REASON_TEXT[MANUAL_BLACKLIST_REASON_CODE],
        };
    }

    if (
        normalizedCode === RESOURCE_UNAVAILABLE_REASON_CODE
        || normalizedCode === 'view-unavailable'
        || normalizedCode === 'yt-dlp-unavailable'
    ) {
        return {
            reasonCode: RESOURCE_UNAVAILABLE_REASON_CODE,
            reasonText: normalizedText || DEFAULT_REASON_TEXT[RESOURCE_UNAVAILABLE_REASON_CODE],
        };
    }

    if (isUnavailableViewMessage(normalizedText || normalizedMessage)) {
        return {
            reasonCode: RESOURCE_UNAVAILABLE_REASON_CODE,
            reasonText: normalizedText || DEFAULT_REASON_TEXT[RESOURCE_UNAVAILABLE_REASON_CODE],
        };
    }

    if (isUnavailableYtDlpMessage(normalizedMessage)) {
        return {
            reasonCode: RESOURCE_UNAVAILABLE_REASON_CODE,
            reasonText: normalizedText || DEFAULT_REASON_TEXT[RESOURCE_UNAVAILABLE_REASON_CODE],
        };
    }

    return {
        reasonCode: RESOURCE_UNAVAILABLE_REASON_CODE,
        reasonText: normalizedText || DEFAULT_REASON_TEXT[RESOURCE_UNAVAILABLE_REASON_CODE],
    };
}

export function createEmptyBlacklistState() {
    return {
        version: DOWNLOAD_BLACKLIST_STATE_VERSION,
        threshold: DOWNLOAD_BLACKLIST_THRESHOLD,
        items: {},
    };
}

function normalizeStoredEntry(entry, fallbackBvid) {
    const storedBvid = normalizeNonEmptyString(entry?.bvid || fallbackBvid);
    const bvidKey = normalizeBvidLookupKey(storedBvid);
    if (!bvidKey) return null;
    const bvid = normalizeNonEmptyString(entry?.bvid, bvidKey);

    const reason = normalizeBlacklistReason({
        reasonCode: entry?.reasonCode,
        reasonText: entry?.reasonText,
        message: entry?.lastMessage,
    });
    const hitCount = Math.max(0, Number(entry?.hitCount) || 0);

    return {
        bvid,
        title: normalizeNonEmptyString(entry?.title, bvid),
        uploader: normalizeNonEmptyString(entry?.uploader),
        uploaderMid: normalizeUploaderMid(entry?.uploaderMid),
        status: entry?.status === 'blacklisted' ? 'blacklisted' : 'observed',
        reasonCode: reason.reasonCode,
        reasonText: reason.reasonText,
        hitCount,
        threshold: DOWNLOAD_BLACKLIST_THRESHOLD,
        firstSeenAt: normalizeTimestamp(entry?.firstSeenAt),
        lastSeenAt: normalizeTimestamp(entry?.lastSeenAt),
        lastSource: normalizeSource(entry?.lastSource),
        lastMessage: normalizeNonEmptyString(entry?.lastMessage),
        favoriteTime: normalizeTimestamp(entry?.favoriteTime),
    };
}

export function normalizeBlacklistState(rawState) {
    const items = {};
    const sourceItems = rawState?.items && typeof rawState.items === 'object'
        ? rawState.items
        : {};

    Object.entries(sourceItems).forEach(([key, entry]) => {
        const normalized = normalizeStoredEntry(entry, key);
        if (normalized?.bvid) {
            items[normalizeBvidLookupKey(normalized.bvid)] = normalized;
        }
    });

    return {
        version: DOWNLOAD_BLACKLIST_STATE_VERSION,
        threshold: DOWNLOAD_BLACKLIST_THRESHOLD,
        items,
    };
}

export function getBlacklistEntry(state, bvid) {
    const bvidKey = normalizeBvidLookupKey(bvid);
    if (!bvidKey) return null;
    return normalizeBlacklistState(state).items[bvidKey] || null;
}

export function isBlacklistedEntry(entry) {
    return entry?.status === 'blacklisted';
}

export function listBlacklistedEntries(state) {
    return Object.values(normalizeBlacklistState(state).items)
        .filter(isBlacklistedEntry)
        .sort((left, right) => {
            const timeDiff = (right.lastSeenAt || 0) - (left.lastSeenAt || 0);
            if (timeDiff !== 0) return timeDiff;
            return left.bvid.localeCompare(right.bvid, 'en');
        });
}

export function recordBlacklistObservation(state, payload, now = Date.now()) {
    const normalizedState = normalizeBlacklistState(state);
    const bvidKey = normalizeBvidLookupKey(payload?.bvid);
    if (!bvidKey) {
        throw new Error('bvid 不能为空');
    }

    const existing = normalizedState.items[bvidKey];
    const reason = normalizeBlacklistReason(payload);
    const increment = payload?.skipIncrement ? 0 : 1;
    const baseHitCount = Number(existing?.hitCount) || 0;
    const forcedBlacklisted = payload?.forceBlacklisted === true;
    const hitCount = forcedBlacklisted
        ? DOWNLOAD_BLACKLIST_THRESHOLD
        : Math.min(baseHitCount + increment, DOWNLOAD_BLACKLIST_THRESHOLD);
    const firstSeenAt = normalizeTimestamp(existing?.firstSeenAt) || now;
    const favoriteTime = normalizeTimestamp(payload?.favoriteTime) || existing?.favoriteTime || null;
    const bvid = normalizeNonEmptyString(payload?.bvid, existing?.bvid || bvidKey);

    const entry = {
        bvid,
        title: normalizeNonEmptyString(payload?.title, existing?.title || bvid),
        uploader: normalizeNonEmptyString(payload?.uploader, existing?.uploader || ''),
        uploaderMid: normalizeUploaderMid(payload?.uploaderMid || existing?.uploaderMid || ''),
        status: forcedBlacklisted || existing?.status === 'blacklisted' || hitCount >= DOWNLOAD_BLACKLIST_THRESHOLD ? 'blacklisted' : 'observed',
        reasonCode: reason.reasonCode,
        reasonText: reason.reasonText,
        hitCount,
        threshold: DOWNLOAD_BLACKLIST_THRESHOLD,
        firstSeenAt,
        lastSeenAt: now,
        lastSource: normalizeSource(payload?.source),
        lastMessage: normalizeNonEmptyString(payload?.message),
        favoriteTime,
    };

    normalizedState.items[bvidKey] = entry;
    return {
        state: normalizedState,
        entry,
    };
}

export function removeBlacklistEntry(state, bvid) {
    const normalizedState = normalizeBlacklistState(state);
    const bvidKey = normalizeBvidLookupKey(bvid);
    if (!bvidKey) {
        throw new Error('bvid 不能为空');
    }

    delete normalizedState.items[bvidKey];
    return normalizedState;
}
