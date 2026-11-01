import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisitTime } from '../../../main/frontend/travel-memory/modules/footprint-data.js';

test('访问时间保留完整时分秒', () => {
    assert.equal(normalizeVisitTime('2026-10-01T09:35:20Z'), '2026-10-01T09:35:20Z');
    assert.equal(normalizeVisitTime('10/01/2026 09:35:20'), '2026-10-01T09:35:20');
    assert.equal(normalizeVisitTime('2026-10-01'), '2026-10-01T00:00:00');
    assert.equal(normalizeVisitTime(''), '');
});
