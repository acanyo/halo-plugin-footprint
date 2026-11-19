import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeProvinceCards } from '../../../main/frontend/travel-memory/modules/province-card-layout.js';
import { overlapArea } from '../../../main/frontend/travel-memory/modules/geometry.js';

const CARD_WIDTH = 244;
const CARD_HEIGHT = 96;

function makeItems(count) {
    return Array.from({length: count}, (_, ci) => ({
        ci,
        w: CARD_WIDTH,
        h: CARD_HEIGHT,
        x: 0,
        y: 0,
        edge: 'right',
        locked: false,
        anchor: null
    }));
}

function arrangeAll(count, width, height) {
    globalThis.window = {innerWidth: width, innerHeight: height};
    const items = makeItems(count);
    arrangeProvinceCards(
        items,
        ci => ({
            x: width * (0.32 + (ci % 5) * 0.09),
            y: height * (0.3 + (ci % 7) * 0.06)
        }),
        () => {},
        'all'
    );
    return items;
}

test('全部城市卡片只排在外圈，数量过多时允许外圈重叠', () => {
    const width = 1280;
    const height = 720;
    const items = arrangeAll(32, width, height);
    const insetX = Math.max(24, Math.round(width * 0.025));
    const area = {
        left: insetX,
        right: width - insetX,
        top: 56,
        bottom: height - 96
    };

    items.forEach(item => {
        const edgeGap = Math.min(
            item.x - area.left,
            area.right - (item.x + item.w),
            item.y - area.top,
            area.bottom - (item.y + item.h)
        );
        assert.ok(edgeGap >= -0.5, `卡片不能越出可用的外圈区域：${JSON.stringify(item)}`);
        assert.ok(edgeGap <= 70, `卡片不应进入内圈：${JSON.stringify(item)}`);
    });

    let overlaps = 0;
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            if (overlapArea(items[i], items[j]) > 0) overlaps++;
        }
    }
    assert.ok(overlaps > 0, '外圈容量不足时应使用重叠，而不是向内补位');
});

test('全部城市卡片空间充足时仍优先不重叠', () => {
    const items = arrangeAll(12, 1600, 1000);
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            assert.equal(overlapArea(items[i], items[j]), 0);
        }
    }
});
