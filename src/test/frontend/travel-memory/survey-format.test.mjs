import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLatitude, formatLongitude, formatDateSpan } from '../../../main/frontend/travel-memory/modules/survey-format.js';

test('坐标写成度分，分进位到 60 时进一度', () => {
    assert.equal(formatLatitude(45.8038), '北纬 45°48′');
    assert.equal(formatLongitude(126.5349), '东经 126°32′');
    assert.equal(formatLatitude(-33.8688), '南纬 33°52′');
    assert.equal(formatLongitude(-0.1276), '西经 0°08′');
    assert.equal(formatLatitude(29.9999), '北纬 30°00′');
    assert.equal(formatLatitude(NaN), '');
});

test('日期跨度：同月、至今、到', () => {
    const today = new Date('2026-10-30T00:00:00');
    assert.equal(formatDateSpan(['2024-05-01', '2024-05-20'], today), '2024 年 5 月');
    assert.equal(formatDateSpan(['2019-03-02', '2026-09-10'], today), '2019 年 3 月至今');
    assert.equal(formatDateSpan(['2019-03-02', '2025-12-04'], today), '2019 年 3 月 到 2025 年 12 月');
    assert.equal(formatDateSpan(['', 'bad'], today), '');
});
