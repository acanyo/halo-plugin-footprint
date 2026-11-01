import test from 'node:test';
import assert from 'node:assert/strict';
import {
    groupDistanceText,
    groupRange,
    groupTripDistance,
    resolveFootprintGroup,
    resolveFootprintGroups,
    sortGroupMembers,
    uniqueGroupMemberNames
} from '../../../main/frontend/travel-memory/modules/footprint-group-model.js';

const bj = (over = {}) => ({
    key: 'bj',
    name: '北京',
    city: '北京',
    cityAdcode: '110100',
    province: '北京',
    provinceAdcode: '110000',
    lng: 116.4074,
    lat: 39.9042,
    createTime: '2024-10-01T09:00:00Z',
    ...over
});

const sh = {
    key: 'sh',
    name: '上海',
    city: '上海',
    cityAdcode: '310100',
    province: '上海',
    provinceAdcode: '310000',
    lng: 121.4737,
    lat: 31.2304,
    createTime: '2024-10-02T10:00:00Z'
};

const group = (over = {}) => ({
    apiVersion: 'footprint.lik.cc/v1alpha1',
    kind: 'FootprintGroup',
    metadata: {
        name: 'national-day',
        creationTimestamp: '2024-10-01T00:00:00Z',
        ...(over.metadata || {})
    },
    spec: {
        groupType: 'trip',
        title: '国庆行程',
        visibility: 'public',
        memberNames: ['sh', 'bj'],
        targetCount: undefined,
        footprintTypes: ['旅游'],
        ...(over.spec || {})
    }
});

test('成员去重、空值清理与完整时间排序', () => {
    assert.deepEqual(uniqueGroupMemberNames(['a', 'a', '', null, 'b']), ['a', 'b']);
    const members = sortGroupMembers([
        bj({ key: 'late', createTime: '2024-10-01T18:00:00Z' }),
        bj({ key: 'early', createTime: '2024-10-01T08:30:00Z' })
    ]);
    assert.deepEqual(members.map(item => item.key), ['early', 'late']);
});

test('日期范围使用访问时间而非录入顺序', () => {
    const range = groupRange([sh, bj()]);
    assert.equal(range.start, bj().createTime);
    assert.equal(range.end, sh.createTime);
    assert.equal(range.days, 2);
});

test('行程路线按 createTime 排序，同城距离也计入', () => {
    const sameCityA = bj({ key: 'bj-a', createTime: '2024-10-01T08:00:00Z', lng: 116.4074 });
    const sameCityB = bj({ key: 'bj-b', createTime: '2024-10-01T10:00:00Z', lng: 116.5000 });
    const members = sortGroupMembers([sameCityB, sh, sameCityA]);
    assert.deepEqual(members.map(item => item.key), ['bj-a', 'bj-b', 'sh']);
    const distance = groupTripDistance(members);
    assert.ok(distance > 1000);
    assert.match(groupDistanceText({ km: 8, sameCity: true }), /市内直线约 8 公里/);
});

test('缺失成员计数、公开/删除状态过滤和封面兜底', () => {
    const footprintMap = new Map([['bj', bj()], ['sh', sh]]);
    const resolved = resolveFootprintGroup(
        group({ spec: { memberNames: ['bj', 'missing', 'sh'] } }),
        footprintMap,
        { imageUrlOf: member => member.key === 'bj' ? '/bj.jpg' : '' }
    );
    assert.equal(resolved.members.length, 2);
    assert.equal(resolved.missingCount, 1);
    assert.equal(resolved.cover, '/bj.jpg');
    assert.equal(
        resolveFootprintGroup(
            group({ spec: { memberNames: ['bj'], visibility: 'private' } }),
            footprintMap
        ),
        null
    );
    assert.equal(
        resolveFootprintGroup(
            group({ metadata: { deletionTimestamp: '2024-10-03T00:00:00Z' } }),
            footprintMap
        ),
        null
    );
});

test('空集合保留并计算目标，集合不生成路线', () => {
    const resolved = resolveFootprintGroup(
        group({
            spec: {
                groupType: 'collection',
                memberNames: [],
                targetCount: 5
            }
        }),
        new Map()
    );
    assert.equal(resolved.members.length, 0);
    assert.equal(resolved.targetCount, 5);
    assert.equal(resolved.distanceKm, 0);
    assert.deepEqual(resolved.segments, []);
});

test('列表按最近访问时间倒序，空集合回退创建时间', () => {
    const list = resolveFootprintGroups(
        [
            group({ metadata: { name: 'older' }, spec: { memberNames: ['bj'] } }),
            group({
                metadata: { name: 'newer', creationTimestamp: '2025-01-01T00:00:00Z' },
                spec: { groupType: 'collection', memberNames: [], targetCount: 2 }
            })
        ],
        [bj()],
        { imageUrlOf: () => '' }
    );
    assert.deepEqual(list.map(item => item.key), ['newer', 'older']);
});
