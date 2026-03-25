import test from 'node:test';
import assert from 'node:assert/strict';

import { ONE_GIB, selectVideoDownloadPlan, summarizeSelectedFormat } from '../src/video-format-selector.mjs';

function makeVideoFormat({
    formatId,
    quality,
    width,
    height,
    fps,
    tbr,
    filesizeApprox,
    vcodec = 'avc1.640028',
    dynamicRange = 'SDR',
}) {
    return {
        format_id: formatId,
        format: `${height}p`,
        quality,
        width,
        height,
        fps,
        tbr,
        filesize_approx: filesizeApprox,
        vcodec,
        acodec: 'none',
        dynamic_range: dynamicRange,
        ext: 'mp4',
    };
}

function makeAudioFormat({
    formatId = '30280',
    abr = 192,
    filesizeApprox = 96 * 1024 * 1024,
}) {
    return {
        format_id: formatId,
        format: 'audio only',
        abr,
        filesize_approx: filesizeApprox,
        acodec: 'mp4a.40.2',
        vcodec: 'none',
        ext: 'm4a',
    };
}

test('prefers the highest fps within the same quality level', () => {
    const info = {
        duration: 600,
        formats: [
            makeVideoFormat({
                formatId: '80-30',
                quality: 80,
                width: 1920,
                height: 1080,
                fps: 30,
                tbr: 3200,
                filesizeApprox: 280 * 1024 * 1024,
            }),
            makeVideoFormat({
                formatId: '80-60',
                quality: 80,
                width: 1920,
                height: 1080,
                fps: 60,
                tbr: 4500,
                filesizeApprox: 420 * 1024 * 1024,
            }),
            makeAudioFormat({ filesizeApprox: 64 * 1024 * 1024 }),
        ],
    };

    const plan = selectVideoDownloadPlan(info);
    assert.ok(plan);
    assert.equal(plan.video.format_id, '80-60');
    assert.equal(plan.audio?.format_id, '30280');
});

test('keeps 4K when an under-limit format exists at the same quality level', () => {
    const info = {
        duration: 900,
        formats: [
            makeVideoFormat({
                formatId: '120-avc',
                quality: 120,
                width: 3840,
                height: 2160,
                fps: 60,
                tbr: 18000,
                filesizeApprox: 1450 * 1024 * 1024,
                vcodec: 'avc1.640033',
            }),
            makeVideoFormat({
                formatId: '120-av1',
                quality: 120,
                width: 3840,
                height: 2160,
                fps: 60,
                tbr: 9800,
                filesizeApprox: 820 * 1024 * 1024,
                vcodec: 'av01.0.12M.10',
            }),
            makeVideoFormat({
                formatId: '116-avc',
                quality: 116,
                width: 1920,
                height: 1080,
                fps: 60,
                tbr: 5200,
                filesizeApprox: 520 * 1024 * 1024,
            }),
            makeAudioFormat({ filesizeApprox: 80 * 1024 * 1024 }),
        ],
    };

    const plan = selectVideoDownloadPlan(info);
    assert.ok(plan);
    assert.equal(plan.video.format_id, '120-av1');
    assert.equal(plan.downgradeCount, 0);
});

test('drops one level when the best quality exceeds 1 GiB', () => {
    const info = {
        duration: 1200,
        formats: [
            makeVideoFormat({
                formatId: '120-4k',
                quality: 120,
                width: 3840,
                height: 2160,
                fps: 60,
                tbr: 22000,
                filesizeApprox: 1350 * 1024 * 1024,
            }),
            makeVideoFormat({
                formatId: '116-1080p60',
                quality: 116,
                width: 1920,
                height: 1080,
                fps: 60,
                tbr: 5200,
                filesizeApprox: 620 * 1024 * 1024,
            }),
            makeVideoFormat({
                formatId: '80-1080p30',
                quality: 80,
                width: 1920,
                height: 1080,
                fps: 30,
                tbr: 3000,
                filesizeApprox: 360 * 1024 * 1024,
            }),
            makeAudioFormat({ filesizeApprox: 96 * 1024 * 1024 }),
        ],
    };

    const plan = selectVideoDownloadPlan(info);
    assert.ok(plan);
    assert.equal(plan.video.format_id, '116-1080p60');
    assert.equal(plan.downgradeCount, 1);
    assert.ok(plan.estimatedSize <= ONE_GIB);
});

test('continues downgrading if the next level is still above the limit', () => {
    const info = {
        duration: 1800,
        formats: [
            makeVideoFormat({
                formatId: '120-4k',
                quality: 120,
                width: 3840,
                height: 2160,
                fps: 60,
                tbr: 32000,
                filesizeApprox: 2200 * 1024 * 1024,
            }),
            makeVideoFormat({
                formatId: '116-1080p60',
                quality: 116,
                width: 1920,
                height: 1080,
                fps: 60,
                tbr: 14000,
                filesizeApprox: 1500 * 1024 * 1024,
            }),
            makeVideoFormat({
                formatId: '80-1080p30',
                quality: 80,
                width: 1920,
                height: 1080,
                fps: 30,
                tbr: 3600,
                filesizeApprox: 620 * 1024 * 1024,
            }),
            makeAudioFormat({ filesizeApprox: 120 * 1024 * 1024 }),
        ],
    };

    const plan = selectVideoDownloadPlan(info);
    assert.ok(plan);
    assert.equal(plan.video.format_id, '80-1080p30');
    assert.equal(plan.downgradeCount, 2);
    assert.ok(plan.estimatedSize <= ONE_GIB);
});

test('summarizes the selected format for metadata/debug logging', () => {
    const info = {
        duration: 300,
        formats: [
            makeVideoFormat({
                formatId: '116-1080p60',
                quality: 116,
                width: 1920,
                height: 1080,
                fps: 60,
                tbr: 4500,
                filesizeApprox: 320 * 1024 * 1024,
                vcodec: 'av01.0.08M.08',
            }),
            makeAudioFormat({ filesizeApprox: 32 * 1024 * 1024 }),
        ],
    };

    const summary = summarizeSelectedFormat(selectVideoDownloadPlan(info));
    assert.deepEqual(summary, {
        formatId: '116-1080p60+30280',
        type: 'adaptive',
        height: 1080,
        width: 1920,
        fps: 60,
        quality: 116,
        dynamicRange: 'SDR',
        videoCodec: 'av01.0.08M.08',
        audioCodec: 'mp4a.40.2',
        estimatedSize: 369098752,
        downgradeCount: 0,
    });
});
