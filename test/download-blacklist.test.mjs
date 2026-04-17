import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOWNLOAD_BLACKLIST_THRESHOLD,
    createEmptyBlacklistState,
    getBlacklistEntry,
    isUnavailableViewMessage,
    isUnavailableYtDlpMessage,
    listBlacklistedEntries,
    normalizeBlacklistReason,
    recordBlacklistObservation,
    removeBlacklistEntry,
} from '../src/download-blacklist.mjs';

test('blacklists an entry after reaching the configured threshold', () => {
    let state = createEmptyBlacklistState();
    let latestEntry = null;

    for (let i = 0; i < DOWNLOAD_BLACKLIST_THRESHOLD; i += 1) {
        const result = recordBlacklistObservation(state, {
            bvid: 'BV1TEST12345',
            title: '测试视频',
            reasonCode: 'favorite-invalid',
            reasonText: '收藏夹条目已失效或下架',
            source: 'favorites-api',
            message: '收藏夹条目已失效或下架',
            favoriteTime: 1710000000,
        }, 1710000000000 + i);
        state = result.state;
        latestEntry = result.entry;
    }

    assert.ok(latestEntry);
    assert.equal(latestEntry.hitCount, DOWNLOAD_BLACKLIST_THRESHOLD);
    assert.equal(latestEntry.status, 'blacklisted');
    assert.equal(listBlacklistedEntries(state).length, 1);
});

test('removeBlacklistEntry clears accumulated state for a bvid', () => {
    const { state } = recordBlacklistObservation(createEmptyBlacklistState(), {
        bvid: 'BV1REMOVE123',
        title: '待恢复视频',
        reasonCode: 'view-unavailable',
        source: 'view-api',
        message: '稿件不存在',
    }, 1710000000000);

    const nextState = removeBlacklistEntry(state, 'BV1REMOVE123');
    assert.deepEqual(listBlacklistedEntries(nextState), []);
    assert.equal(nextState.items.BV1REMOVE123, undefined);
});

test('recordBlacklistObservation preserves uploader fields for link rendering', () => {
    const { entry } = recordBlacklistObservation(createEmptyBlacklistState(), {
        bvid: 'BV1UPMID2345',
        title: '带 UP 主信息的视频',
        uploader: '测试UP',
        uploaderMid: '12345678',
        reasonCode: 'view-unavailable',
        source: 'view-api',
        message: '稿件不存在',
    }, 1710000000000);

    assert.equal(entry.uploader, '测试UP');
    assert.equal(entry.uploaderMid, '12345678');
});

test('recordBlacklistObservation keeps original bvid casing while lookups stay case-insensitive', () => {
    const { state, entry } = recordBlacklistObservation(createEmptyBlacklistState(), {
        bvid: 'BV1cYcCzCEwW',
        title: '大小写测试',
        reasonCode: 'favorite-invalid',
        source: 'favorites-api',
        message: '收藏夹条目已失效或下架',
    }, 1710000000000);

    assert.equal(entry.bvid, 'BV1cYcCzCEwW');
    assert.equal(getBlacklistEntry(state, 'BV1CYCCZCEWW')?.bvid, 'BV1cYcCzCEwW');
});

test('skipIncrement keeps blacklisted entries at threshold while allowing metadata sync', () => {
    let state = createEmptyBlacklistState();
    for (let i = 0; i < DOWNLOAD_BLACKLIST_THRESHOLD; i += 1) {
        state = recordBlacklistObservation(state, {
            bvid: 'BV1SYNC12345',
            title: '同步测试',
            reasonCode: 'favorite-invalid',
            source: 'favorites-api',
            message: '收藏夹条目已失效或下架',
        }, 1710000000000 + i).state;
    }

    const { entry } = recordBlacklistObservation(state, {
        bvid: 'BV1SYNC12345',
        title: '同步测试',
        uploader: '补齐UP主',
        uploaderMid: '99887766',
        reasonCode: 'favorite-invalid',
        source: 'favorites-api',
        message: '黑名单元数据同步',
        skipIncrement: true,
    }, 1710000009999);

    assert.equal(entry.hitCount, DOWNLOAD_BLACKLIST_THRESHOLD);
    assert.equal(entry.status, 'blacklisted');
    assert.equal(entry.uploaderMid, '99887766');
});

test('forceBlacklisted immediately moves an entry into blacklist for manual operations', () => {
    const { entry } = recordBlacklistObservation(createEmptyBlacklistState(), {
        bvid: 'BV1MANUAL999',
        title: '手动拉黑测试',
        reasonCode: 'manual-blacklist',
        reasonText: '手动加入黑名单',
        source: 'manual',
        message: '手动加入黑名单',
        forceBlacklisted: true,
    }, 1710000000000);

    assert.equal(entry.hitCount, DOWNLOAD_BLACKLIST_THRESHOLD);
    assert.equal(entry.status, 'blacklisted');
    assert.equal(entry.lastSource, 'manual');
});

test('normalizeBlacklistReason keeps favorite-invalid distinct from generic unavailable', () => {
    assert.deepEqual(
        normalizeBlacklistReason({
            reasonCode: 'favorite-invalid',
            reasonText: '',
            message: '',
        }),
        {
            reasonCode: 'favorite-invalid',
            reasonText: '收藏夹条目已失效或下架',
        },
    );

    assert.deepEqual(
        normalizeBlacklistReason({
            reasonCode: 'yt-dlp-unavailable',
            reasonText: '',
            message: 'HTTP Error 404: Not Found',
        }),
        {
            reasonCode: 'resource-unavailable',
            reasonText: '资源不存在或不可访问',
        },
    );
});

test('explicit unavailable messages are detected while transient errors are ignored', () => {
    assert.equal(isUnavailableViewMessage('稿件不存在', -404), true);
    assert.equal(isUnavailableViewMessage('请求超时，请稍后重试', 0), false);

    assert.equal(isUnavailableYtDlpMessage('ERROR: HTTP Error 404: Not Found'), true);
    assert.equal(isUnavailableYtDlpMessage('ERROR: timed out after 10 seconds'), false);
});
