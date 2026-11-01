/**
 * 我的旅途集的纯数据口径。
 *
 * 页面元素、Cesium、AMap 都不在这里出现。前台详情、后台快照和地图路线
 * 只消费这里生成的归一化结果，避免三处各排一次时间、各算一次距离。
 */

import { haversineKm } from './footprints-insight.js';

export const MAX_GROUP_MEMBERS = 500;

export function uniqueGroupMemberNames(names) {
    if (!Array.isArray(names)) return [];
    return [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))];
}

export function compareFootprintsByCreateTime(a, b) {
    const timeA = String((a && a.createTime) || '');
    const timeB = String((b && b.createTime) || '');
    if (!timeA && timeB) return 1;
    if (timeA && !timeB) return -1;
    const parsedA = Date.parse(timeA);
    const parsedB = Date.parse(timeB);
    if (Number.isFinite(parsedA) && Number.isFinite(parsedB) && parsedA !== parsedB) {
        return parsedA - parsedB;
    }
    const byTime = timeA.localeCompare(timeB);
    if (byTime) return byTime;
    return String((a && (a.key || a.name)) || '').localeCompare(
        String((b && (b.key || b.name)) || ''),
        'zh-Hans-CN'
    );
}

export function sortGroupMembers(members) {
    return members.slice().sort(compareFootprintsByCreateTime);
}

export function groupRange(members) {
    const dated = members
        .filter(member => member && member.createTime)
        .slice()
        .sort(compareFootprintsByCreateTime);
    if (!dated.length) return { start: '', end: '', days: 0 };
    const start = String(dated[0].createTime);
    const end = String(dated[dated.length - 1].createTime);
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const localDay = date => new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    ).getTime();
    const days = Number.isFinite(startTime) && Number.isFinite(endTime)
        ? Math.max(1, Math.floor((localDay(endDate) - localDay(startDate)) / 86400000) + 1)
        : 0;
    return { start, end, days };
}

export function validCoordinate(fp) {
    const lng = Number(fp && fp.lng);
    const lat = Number(fp && fp.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 &&
        !(lng === 0 && lat === 0);
}

export function sameGroupCity(a, b) {
    const cityA = String((a && (a.cityAdcode || a.city)) || '').trim();
    const cityB = String((b && (b.cityAdcode || b.city)) || '').trim();
    return !!cityA && cityA === cityB;
}

export function groupTripSegments(members) {
    const segments = [];
    for (let i = 1; i < members.length; i += 1) {
        const from = members[i - 1];
        const to = members[i];
        if (!validCoordinate(from) || !validCoordinate(to)) {
            segments.push({ from, to, km: null, sameCity: sameGroupCity(from, to), reason: 'missing-coordinate' });
            continue;
        }
        const km = haversineKm(from, to);
        segments.push({
            from,
            to,
            km: Number.isFinite(km) ? km : null,
            sameCity: sameGroupCity(from, to),
            reason: Number.isFinite(km) ? '' : 'invalid-distance'
        });
    }
    return segments;
}

export function groupTripDistance(members) {
    return groupTripSegments(members).reduce((sum, segment) => sum + (segment.km || 0), 0);
}

function groupCover(group, members, imageUrlOf) {
    const custom = String((group && group.spec && group.spec.cover) || '').trim();
    if (custom) return custom;
    for (const member of members) {
        const url = typeof imageUrlOf === 'function' ? imageUrlOf(member) : '';
        if (url) return url;
    }
    return '';
}

export function resolveFootprintGroup(group, footprintMap, options = {}) {
    if (!group || !group.metadata || !group.spec) return null;
    if (group.metadata.deletionTimestamp) return null;
    if (options.publicOnly !== false && group.spec.visibility && group.spec.visibility !== 'public') return null;
    const names = uniqueGroupMemberNames(group.spec.memberNames).slice(0, MAX_GROUP_MEMBERS);
    const resolved = names.map(name => footprintMap.get(name)).filter(Boolean);
    const members = sortGroupMembers(resolved);
    const range = groupRange(members);
    const segments = group.spec.groupType === 'trip' ? groupTripSegments(members) : [];
    const distanceKm = segments.reduce((sum, segment) => sum + (segment.km || 0), 0);
    return {
        key: group.metadata.name,
        metadata: group.metadata,
        groupType: group.spec.groupType === 'collection' ? 'collection' : 'trip',
        title: String(group.spec.title || '').trim() || '未命名',
        description: String(group.spec.description || '').trim(),
        visibility: group.spec.visibility === 'private' ? 'private' : 'public',
        article: String(group.spec.article || '').trim(),
        footprintTypes: Array.isArray(group.spec.footprintTypes)
            ? group.spec.footprintTypes.map(type => String(type || '').trim()).filter(Boolean)
            : [],
        targetCount: Number.isInteger(Number(group.spec.targetCount)) && Number(group.spec.targetCount) > 0
            ? Number(group.spec.targetCount)
            : 0,
        names,
        members,
        missingCount: Math.max(0, names.length - resolved.length),
        range,
        cityCount: new Set(members.map(fp => fp.cityAdcode || fp.city).filter(Boolean)).size,
        provinceCount: new Set(members.map(fp => fp.provinceAdcode || fp.province).filter(Boolean)).size,
        photoCount: members.reduce((sum, fp) => sum + (options.imagesOf ? options.imagesOf(fp).length : 0), 0),
        unlocatableCount: members.filter(member => !validCoordinate(member)).length,
        segments,
        distanceKm,
        cover: groupCover(group, members, options.imageUrlOf)
    };
}

export function resolveFootprintGroups(groups, footprints, options = {}) {
    const footprintMap = new Map(footprints.map(fp => [fp.key, fp]));
    return (Array.isArray(groups) ? groups : [])
        .map(group => resolveFootprintGroup(group, footprintMap, options))
        .filter(Boolean)
        .sort((a, b) => {
            const byEnd = String(b.range.end || b.metadata.creationTimestamp || '').localeCompare(
                String(a.range.end || a.metadata.creationTimestamp || '')
            );
            return byEnd || a.key.localeCompare(b.key);
        });
}

export function groupDistanceText(segment) {
    if (!segment || segment.km == null) return '缺少坐标，未计入距离';
    if (segment.km < 1) return '< 1 公里';
    const km = Math.round(segment.km).toLocaleString('zh-CN');
    return segment.sameCity ? '市内直线约 ' + km + ' 公里' : '直线约 ' + km + ' 公里';
}
