import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFootprintWishesFromJson } from '../../../main/frontend/travel-memory/modules/footprint-data.js';

function wish(name, spec = {}, metadata = {}) {
    return {
        apiVersion: 'footprint.lik.cc/v1alpha1',
        kind: 'FootprintWish',
        metadata: { name, ...metadata },
        spec: {
            title: name,
            longitude: 120,
            latitude: 30,
            status: 'wish',
            visibility: 'public',
            ...spec
        }
    };
}

test('未来足迹前台只加载公开且未删除的地点', () => {
    globalThis.window = {
        FOOTPRINT_CONFIG: {
            footprintWishes: [
                wish('public'),
                wish('private', { visibility: 'private' }),
                wish('deleted', {}, { deletionTimestamp: '2026-11-01T00:00:00Z' }),
                wish('planning', { status: 'planning' })
            ]
        }
    };

    assert.deepEqual(
        loadFootprintWishesFromJson().map(item => item.metadata.name),
        ['public', 'planning']
    );
});

test('没有未来足迹配置时返回空数组', () => {
    globalThis.window = { FOOTPRINT_CONFIG: {} };
    assert.deepEqual(loadFootprintWishesFromJson(), []);
});
