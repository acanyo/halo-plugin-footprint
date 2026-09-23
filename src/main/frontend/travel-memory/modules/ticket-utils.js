/**
 * 票根的排序与坐标校验工具。重走一遍、护照集章、命运抽票都依赖这套判定，
 * 各处必须用同一份，否则同一批票在不同功能里顺序不一致。
 *
 * 全是纯函数，不碰 DOM、不碰 Cesium、不读任何共享状态——
 * 唯一用到外部可变数据的 sortedTicketItems() 留在主文件里当薄包装
 * （它闭包引用 ticketItems），这样调用点一处都不用改。
 */

function ticketTimeKey(fp) {
    return String((fp && (fp.ticketDate || fp.createTime)) || '');
}

function ticketNameKey(fp) {
    return String((fp && (fp.name || fp.ticketTitle)) || '');
}

// 全局统一的时间线排序：ticketDate || createTime 升序；
// 两个字段都缺失的票排到最后（空串 localeCompare 最小，直接字符串比较会把它排到最前）；
// 同值按名称、key 兜底，保证重走/护照各功能顺序一致。
export function compareTicketByTime(a, b) {
    const ka = ticketTimeKey(a);
    const kb = ticketTimeKey(b);
    if (!ka && kb) return 1;
    if (ka && !kb) return -1;
    const byDate = ka.localeCompare(kb);
    if (byDate) return byDate;
    const byName = ticketNameKey(a).localeCompare(ticketNameKey(b), 'zh-Hans-CN');
    if (byName) return byName;
    return String((a && a.key) || '').localeCompare(String((b && b.key) || ''));
}

export function ticketHasCoordinate(fp) {
    if (!fp) return false;
    const rawLng = fp.lng;
    const rawLat = fp.lat;
    // 空值不能走 Number()：Number(null) / Number('') 都是 0，会被误判成有效坐标
    if (rawLng === '' || rawLng == null || rawLat === '' || rawLat == null) return false;
    const lng = Number(rawLng);
    const lat = Number(rawLat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
    // (0, 0) 是后台表单未填写坐标时的默认值，视为没有定位
    return !(lng === 0 && lat === 0);
}

// 同城判定：优先比 adcode，没有 adcode 才比城市名；
// 两边都得有值，否则城市为空的票根会被误判成“同一城市”，整场放映一次都不飞。
export function isSameTicketCity(a, b) {
    const codeA = String((a && a.cityAdcode) || '').trim();
    const codeB = String((b && b.cityAdcode) || '').trim();
    if (codeA && codeB) return codeA === codeB;
    const cityA = String((a && a.city) || '').trim();
    const cityB = String((b && b.city) || '').trim();
    return !!cityA && cityA === cityB;
}
