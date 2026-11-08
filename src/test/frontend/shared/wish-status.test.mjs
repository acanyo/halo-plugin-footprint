import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isMapWishStatus,
    wishStatusKey,
    wishStatusLabel
} from '../../../main/frontend/shared/wish-status.js';

test('未来足迹状态统一文案与未知值兜底', () => {
    assert.equal(wishStatusKey('wish'), 'wish');
    assert.equal(wishStatusKey('planning'), 'planning');
    assert.equal(wishStatusKey('booked'), 'booked');
    assert.equal(wishStatusKey('visited'), 'visited');
    assert.equal(wishStatusKey('unknown'), 'wish');
    assert.equal(wishStatusKey(''), 'wish');
    assert.equal(wishStatusLabel('planning'), '计划中');
    assert.equal(wishStatusLabel('unknown'), '心愿');
});

test('未来足迹地图只包含心愿、计划中和已订票', () => {
    assert.equal(isMapWishStatus('wish'), true);
    assert.equal(isMapWishStatus('planning'), true);
    assert.equal(isMapWishStatus('booked'), true);
    assert.equal(isMapWishStatus('visited'), false);
});
