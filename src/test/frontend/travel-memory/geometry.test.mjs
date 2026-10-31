import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clampNumber, round1, snapDevicePx, overlapArea, ringSampleIndexes, fitBox,
    offsetCenteredRects, rectsBBox, totalOverlapArea, pushVector, angleGap
} from '../../../main/frontend/travel-memory/modules/geometry.js';

test('clampNumber / round1', () => {
    assert.equal(clampNumber(5, 0, 3), 3);
    assert.equal(clampNumber(-1, 0, 3), 0);
    assert.equal(clampNumber(2, 0, 3), 2);
    assert.equal(round1(1.26), 1.3);
    assert.equal(round1(-1.24), -1.2);
});

test('snapDevicePx 按 devicePixelRatio 对齐到设备像素', () => {
    globalThis.window = { devicePixelRatio: 1.5 };
    try {
        assert.equal(snapDevicePx(10.2), 10);        // 15.3 → 15 设备像素
        assert.equal(snapDevicePx(10.4), 32 / 3);    // 15.6 → 16 设备像素
        window.devicePixelRatio = 0;                 // 缺省按 1
        assert.equal(snapDevicePx(10.6), 11);
    } finally {
        delete globalThis.window;
    }
});

test('overlapArea：相交、贴边、不相交', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    assert.equal(overlapArea(a, { x: 5, y: 5, w: 10, h: 10 }), 25);
    assert.equal(overlapArea(a, { x: 10, y: 0, w: 5, h: 5 }), 0);   // 只贴边不算
    assert.equal(overlapArea(a, { x: 20, y: 20, w: 5, h: 5 }), 0);
    assert.equal(overlapArea(a, { x: 2, y: 2, w: 3, h: 3 }), 9);    // 完全包含
});

test('ringSampleIndexes：含首末、去重、不足时返回全部', () => {
    assert.deepEqual(ringSampleIndexes(12, 5), [0, 3, 6, 8, 11]);
    assert.deepEqual(ringSampleIndexes(3, 5), [0, 1, 2]);
    assert.deepEqual(ringSampleIndexes(0, 5), []);
    for (const [n, k] of [[6, 5], [7, 6], [100, 9]]) {
        const idx = ringSampleIndexes(n, k);
        assert.equal(idx.length, k);
        assert.equal(new Set(idx).size, k);
        assert.equal(idx[0], 0);
        assert.equal(idx[k - 1], n - 1);
    }
});

test('fitBox：等比装盒、上下限、缺尺寸按 4:3', () => {
    assert.deepEqual(fitBox(1600, 900, 320, 320), { w: 320, h: 180 });
    assert.deepEqual(fitBox(900, 1600, 320, 320), { w: 180, h: 320 });
    assert.deepEqual(fitBox(0, undefined, 400, 400), { w: 400, h: 300 });
    assert.deepEqual(fitBox(4000, 100, 300, 300, 0, 60), { w: 300, h: 60 });   // 全景图被最小高夹住
});

test('offsetCenteredRects / rectsBBox', () => {
    const rects = offsetCenteredRects([{ x: 10, y: 10, w: 4, h: 2 }, { x: 0, y: 0, w: 2, h: 2 }], 1, -1);
    assert.deepEqual(rects, [{ x: 9, y: 8, w: 4, h: 2 }, { x: 0, y: -2, w: 2, h: 2 }]);
    assert.deepEqual(rectsBBox(rects), { minX: 0, maxX: 13, minY: -2, maxY: 10 });
    assert.deepEqual(rectsBBox([]), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
});

test('totalOverlapArea 逐张累加，不按包围盒', () => {
    const card = { x: 4, y: 4, w: 2, h: 2 };
    // 两张图分在卡片两侧，包围盒盖住卡片，但没有一张真的压到它
    assert.equal(totalOverlapArea([{ x: 0, y: 0, w: 4, h: 10 }, { x: 6, y: 0, w: 4, h: 10 }], card), 0);
    assert.equal(totalOverlapArea([{ x: 3, y: 3, w: 2, h: 2 }, { x: 5, y: 5, w: 2, h: 2 }], card), 2);
    assert.equal(totalOverlapArea([{ x: 0, y: 0, w: 10, h: 10 }], null), 0);
});

test('pushVector 取位移最小的方向', () => {
    const card = { x: 0, y: 0, w: 100, h: 100 };
    // 图压住卡片右边缘 10px：向左推 10 最省
    assert.deepEqual(pushVector([{ x: 90, y: 40, w: 50, h: 20 }], card), { dx: 10, dy: 0, dist: 10 });
    assert.deepEqual(pushVector([{ x: 40, y: -15, w: 20, h: 20 }], card), { dx: 0, dy: -5, dist: 5 });
    assert.deepEqual(pushVector([{ x: 200, y: 200, w: 10, h: 10 }], card), { dx: 0, dy: 0, dist: 0 });
});

test('angleGap 落在 0~π，跨 2π 取短边', () => {
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`);
    close(angleGap(0.1, Math.PI * 2 - 0.1), 0.2);
    close(angleGap(0, Math.PI), Math.PI);
    close(angleGap(-Math.PI / 2, Math.PI / 2), Math.PI);
    close(angleGap(1, 1 + Math.PI * 4), 0);
});
