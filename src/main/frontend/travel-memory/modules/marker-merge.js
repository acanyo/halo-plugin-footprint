/**
 * 城市圆点的屏幕空间合并（纯函数，不碰 Cesium）。
 *
 * 整球视野下华东一带几十座城市挤在几十像素里，圆点叠成一团、数字认不出。
 * 这里按「屏幕上的距离」把挨得太近的城市并成一组：组里足迹最多的那座城当代表，
 * 代表的圆点显示全组足迹数之和，其余的先藏起来；拉近后距离够了自然分开。
 *
 * 贪心：按足迹数从多到少依次当代表，吸收它半径内还没被收走的城市。
 * 相同输入一定得到相同分组。地球自转时屏幕距离一直在微变，正好卡在半径上的两座城会
 * 一帧并、一帧分地闪：上一帧已经并在一起的，要拉开到 radius × stick 才分开。
 */

/**
 * @param points  [{ x, y, count }]，屏幕坐标；不可见的城市传 null（不参与合并）
 * @param radius  两个圆心在这个距离内就并成一组（像素）
 * @param prev    上一次的归属表（可省略）
 * @param stick   已经并着的，放宽到 radius × stick 才分开
 * @returns       每座城市的归属：代表的下标（自己是代表就是自己，不可见是 -1）
 */
export function mergeNearbyPoints(points, radius, prev = null, stick = 1.2) {
    const owner = points.map(() => -1);
    const order = points
        .map((p, i) => i)
        .filter(i => points[i])
        .sort((a, b) => (points[b].count - points[a].count) || (a - b));
    const r2 = radius * radius;
    const stickR2 = r2 * stick * stick;
    order.forEach(lead => {
        if (owner[lead] !== -1) return;
        owner[lead] = lead;
        const p = points[lead];
        order.forEach(i => {
            if (owner[i] !== -1) return;
            const dx = points[i].x - p.x;
            const dy = points[i].y - p.y;
            const limit = prev && prev[i] === lead ? stickR2 : r2;
            if (dx * dx + dy * dy <= limit) owner[i] = lead;
        });
    });
    return owner;
}

/**
 * 把归属表折成每个代表的合计。
 * @returns Map<代表下标, { count: 全组足迹数, members: [组内下标] }>
 */
export function summarizeGroups(points, owner) {
    const groups = new Map();
    owner.forEach((lead, i) => {
        if (lead < 0) return;
        if (!groups.has(lead)) groups.set(lead, { count: 0, members: [] });
        const group = groups.get(lead);
        group.count += points[i].count;
        group.members.push(i);
    });
    return groups;
}
