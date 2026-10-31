import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNearbyPoints, summarizeGroups } from '../../../main/frontend/travel-memory/modules/marker-merge.js';

test('离得远的城市各自成组', () => {
    const pts = [{ x: 0, y: 0, count: 2 }, { x: 100, y: 0, count: 3 }];
    assert.deepEqual(mergeNearbyPoints(pts, 30), [0, 1]);
});

test('挨着的城市并到足迹最多的那座', () => {
    const pts = [{ x: 0, y: 0, count: 2 }, { x: 10, y: 0, count: 5 }, { x: 20, y: 0, count: 1 }];
    const owner = mergeNearbyPoints(pts, 30);
    assert.deepEqual(owner, [1, 1, 1]);
    const groups = summarizeGroups(pts, owner);
    assert.equal(groups.size, 1);
    assert.deepEqual(groups.get(1), { count: 8, members: [0, 1, 2] });
});

test('不可见的城市不参与，也不占代表', () => {
    const pts = [null, { x: 0, y: 0, count: 1 }, { x: 5, y: 0, count: 1 }];
    const owner = mergeNearbyPoints(pts, 30);
    assert.deepEqual(owner, [-1, 1, 1]);
    assert.equal(summarizeGroups(pts, owner).get(1).count, 2);
});

test('足迹数相同时按下标定代表，结果稳定', () => {
    const pts = [{ x: 0, y: 0, count: 2 }, { x: 10, y: 0, count: 2 }];
    assert.deepEqual(mergeNearbyPoints(pts, 30), [0, 0]);
    assert.deepEqual(mergeNearbyPoints(pts, 30), [0, 0]);
});

test('只吸收代表半径内的，链式相邻不会串成一大组', () => {
    // 0—1—2 每段 25px，半径 30：0 当代表收 1，2 离 0 有 50px，自成一组
    const pts = [{ x: 0, y: 0, count: 3 }, { x: 25, y: 0, count: 1 }, { x: 50, y: 0, count: 1 }];
    assert.deepEqual(mergeNearbyPoints(pts, 30), [0, 0, 2]);
});

test('已经并着的要多拉开一点才分开，不在半径上来回闪', () => {
    const pts = [{ x: 0, y: 0, count: 3 }, { x: 33, y: 0, count: 1 }];
    assert.deepEqual(mergeNearbyPoints(pts, 30), [0, 1]);              // 新算：33 > 30，分开
    assert.deepEqual(mergeNearbyPoints(pts, 30, [0, 0]), [0, 0]);      // 上一帧并着：33 < 36，仍并着
    const far = [{ x: 0, y: 0, count: 3 }, { x: 40, y: 0, count: 1 }];
    assert.deepEqual(mergeNearbyPoints(far, 30, [0, 0]), [0, 1]);      // 40 > 36，分开
});
