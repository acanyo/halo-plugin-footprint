import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    compareTicketByTime, ticketHasCoordinate, isSameTicketCity
} from '../../../main/frontend/travel-memory/modules/ticket-utils.js';

test('compareTicketByTime：ticketDate 优先、缺日期排最后、同日按名称再按 key', () => {
    const list = [
        { key: 'z', name: '无日期' },
        { key: 'b', name: '乙', createTime: '2024-05-01' },
        { key: 'a', name: '甲', ticketDate: '2024-05-01', createTime: '2030-01-01' },
        { key: 'c', name: '丙', createTime: '2023-01-01' },
        { key: 'd2', name: '甲', createTime: '2024-05-01' },
        { key: 'd1', name: '甲', createTime: '2024-05-01' }
    ];
    const keys = list.slice().sort(compareTicketByTime).map(t => t.key);
    assert.equal(keys[0], 'c');
    assert.equal(keys[keys.length - 1], 'z');
    // 2024-05-01 这组：甲(a, d1, d2) 在乙(b) 前，同名按 key
    assert.deepEqual(keys.slice(1, 5), ['a', 'd1', 'd2', 'b']);
    assert.equal(compareTicketByTime(null, null), 0);
});

test('ticketHasCoordinate：空值、(0,0)、越界都不算', () => {
    assert.equal(ticketHasCoordinate({ lng: 116.4, lat: 39.9 }), true);
    assert.equal(ticketHasCoordinate({ lng: '116.4', lat: '39.9' }), true);
    assert.equal(ticketHasCoordinate({ lng: 0, lat: 0 }), false);
    assert.equal(ticketHasCoordinate({ lng: '', lat: 39.9 }), false);
    assert.equal(ticketHasCoordinate({ lng: null, lat: null }), false);
    assert.equal(ticketHasCoordinate({ lng: 'abc', lat: 1 }), false);
    assert.equal(ticketHasCoordinate({ lng: 181, lat: 1 }), false);
    assert.equal(ticketHasCoordinate({ lng: 1, lat: -91 }), false);
    assert.equal(ticketHasCoordinate(null), false);
    assert.equal(ticketHasCoordinate({ lng: 0, lat: 10 }), true);   // 只有一边为 0 是有效坐标
});

test('isSameTicketCity：adcode 优先，空城市不算同城', () => {
    assert.equal(isSameTicketCity({ cityAdcode: '310100', city: '上海' }, { cityAdcode: '310100', city: '上海市' }), true);
    assert.equal(isSameTicketCity({ cityAdcode: '310100', city: '上海' }, { cityAdcode: '110100', city: '上海' }), false);
    assert.equal(isSameTicketCity({ city: ' 杭州 ' }, { cityAdcode: '330100', city: '杭州' }), true);
    assert.equal(isSameTicketCity({ city: '' }, { city: '' }), false);
    assert.equal(isSameTicketCity(null, undefined), false);
});
