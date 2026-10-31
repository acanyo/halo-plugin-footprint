import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accentInkFor, normalizeAccent, parseHslTriplet, DEFAULT_ACCENT } from '../../../main/frontend/shared/accent.js';

test('旧的 h,s%,l% 三元组换成 #rrggbb', () => {
    // hsl(322, 68%, 60%)：r = 0.872, g = 0.328, b = 0.6725 → 222, 84, 171
    assert.equal(normalizeAccent('322,68%,60%'), '#de54ab');
    assert.equal(normalizeAccent('109,68%,60%'), '#6dde54');
    assert.equal(normalizeAccent(' 0 , 0% , 100% '), '#ffffff');
});

test('也认带 hsl() 或 deg 的写法', () => {
    assert.deepEqual(parseHslTriplet('hsl(322deg, 68%, 60%)'), parseHslTriplet('322,68%,60%'));
});

test('取色组件存的 hex 原样（统一小写、补全三位写法）', () => {
    assert.equal(normalizeAccent('#7C7BC0'), '#7c7bc0');
    assert.equal(normalizeAccent('#abc'), '#aabbcc');
    assert.equal(normalizeAccent('7c7bc0'), '#7c7bc0');
});

test('认不出来的值用默认淡紫', () => {
    for (const bad of ['', null, undefined, 'red', '322,68,60', '#12345']) {
        assert.equal(normalizeAccent(bad), DEFAULT_ACCENT, String(bad));
    }
});

test('实底上的字：深色配白字，很浅的颜色配深墨字', () => {
    assert.equal(accentInkFor('#7c7bc0'), '#ffffff');
    assert.equal(accentInkFor('#1f3a8a'), '#ffffff');
    assert.equal(accentInkFor('#f5e663'), '#3a3a40');
    assert.equal(accentInkFor('#ffffff'), '#3a3a40');
});
