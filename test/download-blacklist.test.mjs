import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOWNLOAD_BLACKLIST_THRESHOLD,
    createEmptyBlacklistState,
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
