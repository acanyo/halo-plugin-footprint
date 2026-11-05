/**
 * 足迹数据加载与统计区文案。
 *
 * 数据只有两个来源：模板注入的 window.FOOTPRINT_CONFIG.footprints，以及空数组。
 * 不内置任何兜底样例 —— 没有数据就老实显示空状态。
 *
 * 数组引用刻意保持不变（原地 length/push 更新），主文件里那些 `() => FOOTPRINTS`
 * 取值函数因此不需要改成快照重取。
 */

import { formatDateSpan, formatLatitude } from './survey-format.js';

let dataReady = false;   // 首次加载是否已完成（含「确实为空」）

/** 足迹数组（引用稳定，内容原地更新）。 */
export const FOOTPRINTS = [];
export const FOOTPRINT_GROUPS = [];
export const FOOTPRINT_WISHES = [];

export function isFootprintDataReady() {
    return dataReady;
}

export function markFootprintDataReady() {
    dataReady = true;
}

// ================= 足迹数据加载（FOOTPRINT_CONFIG） =================
// window.FOOTPRINT_CONFIG.footprints 为 Footprint CRD 数组（模板注入），坐标均为高德（GCJ-02）来源。
// 加载失败时回退到上面的内置数据。
function mapTestJsonEntry(entry) {
    const s = entry && entry.spec;
    if (!s || !s.name) return null;
    return {
        key: (entry.metadata && entry.metadata.name) || '',
        name: s.name,
        description: s.description || '',
        address: s.address || '',
        lng: Number(s.longitude),
        lat: Number(s.latitude),
        coordType: 'gcj02',   // test.json 坐标均为高德（GCJ-02）来源
        city: s.city || '',
        province: s.province || '',
        provinceAdcode: String(s.provinceAdcode || ''),
        cityAdcode: String(s.cityAdcode || ''),
        footprintType: s.footprintType || '',
        createTime: normalizeVisitTime(s.createTime),
        article: s.article || '',
        zoomLevel: Number(s.zoomLevel) || 12,
        image: s.image || '',
        ticketImage: s.ticketImage || '',
        ticketTitle: s.ticketTitle || '',
        ticketEnglish: s.ticketEnglish || '',
        ticketSubtitle: s.ticketSubtitle || '',
        ticketDate: s.ticketDate || '',
        ticketRoute: s.ticketRoute || '',
        ticketNo: s.ticketNo || '',
        ticketType: s.ticketType || '',
        galleryImages: normalizeGalleryImages(s.galleryImages)
    };
}

function normalizeGalleryImages(images) {
    if (!Array.isArray(images)) return [];
    return images
        .map((image, index) => {
            if (typeof image === 'string') return { url: image, caption: '', order: index + 1 };
            return {
                url: (image && image.url) || '',
                caption: '',
                order: Number(image && image.order) || index + 1
            };
        })
        .filter(image => image.url)
        .sort((a, b) => a.order - b.order);
}

// createTime 是访问时间。兼容旧测试数据的 MM/DD/YYYY，但必须保留完整时分秒，
// 行程排序不能退化成只比较日期。
export function normalizeVisitTime(str) {
    if (!str) return '';
    const raw = String(str).trim();
    const m = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(raw);
    if (m) {
        const time = String(m[4] || '').trim() || '00:00:00';
        return m[3] + '-' + m[1] + '-' + m[2] + 'T' + time;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw + 'T00:00:00';
    return raw;
}

// 足迹数据源：只读取模板注入的 window.FOOTPRINT_CONFIG.footprints；
// 配置为空/无效时返回空数组，页面保持无足迹状态，不再回退样例数据。
export async function loadFootprintsFromJson() {
    try {
        const cfg = window.FOOTPRINT_CONFIG || {};
        const list = Array.isArray(cfg.footprints) ? cfg.footprints : [];
        const mapped = list.map(mapTestJsonEntry).filter(Boolean);
        return mapped;
    } catch (e) {
        console.warn('足迹配置解析失败：', e);
        return [];
    }
}

export function loadFootprintGroupsFromJson() {
    const list = window.FOOTPRINT_CONFIG && Array.isArray(window.FOOTPRINT_CONFIG.footprintGroups)
        ? window.FOOTPRINT_CONFIG.footprintGroups
        : [];
    return list.filter(group =>
        group && group.metadata && group.metadata.name &&
        !group.metadata.deletionTimestamp &&
        group.spec && (!group.spec.visibility || group.spec.visibility === 'public')
    );
}

export function loadFootprintWishesFromJson() {
    const list = window.FOOTPRINT_CONFIG && Array.isArray(window.FOOTPRINT_CONFIG.footprintWishes)
        ? window.FOOTPRINT_CONFIG.footprintWishes
        : [];
    return list.filter(wish =>
        wish && wish.metadata && wish.metadata.name &&
        !wish.metadata.deletionTimestamp &&
        wish.spec && (!wish.spec.visibility || wish.spec.visibility === 'public')
    );
}

// 用加载到的数据替换足迹数组（保持数组引用不变，各处引用自动生效）
export function applyFootprints(loaded) {
    if (!Array.isArray(loaded)) return false;
    FOOTPRINTS.length = 0;
    FOOTPRINTS.push(...loaded);
    return true;
}

export function applyFootprintGroups(loaded) {
    FOOTPRINT_GROUPS.length = 0;
    FOOTPRINT_GROUPS.push(...(Array.isArray(loaded) ? loaded : []));
}

export function applyFootprintWishes(loaded) {
    FOOTPRINT_WISHES.length = 0;
    FOOTPRINT_WISHES.push(...(Array.isArray(loaded) ? loaded : []));
}

// 统计区：总足迹数 / 去过的城市数（数据驱动）
export function updateIntroStats() {
    const total = document.getElementById('introTotal');
    const cities = document.getElementById('introCities');
    if (total) total.textContent = FOOTPRINTS.length;
    if (cities) cities.textContent = new Set(FOOTPRINTS.map(f => f.city).filter(Boolean)).size;

    // 时间跨度与最北点：都是真实数据，没有就整行不显示
    const span = formatDateSpan(FOOTPRINTS.map(f => f.createTime));
    setIntroRow('introSpanRow', 'introSpan', span);
    const north = FOOTPRINTS
        .filter(f => Number.isFinite(f.lat) && f.lat !== 0)
        .reduce((best, f) => (!best || f.lat > best.lat ? f : best), null);
    setIntroRow('introExtentRow', 'introExtent',
        north ? (north.city || north.name) + '，' + formatLatitude(north.lat) : '');
}

function setIntroRow(rowId, valueId, text) {
    const row = document.getElementById(rowId);
    const value = document.getElementById(valueId);
    if (!row || !value) return;
    value.textContent = text;
    row.hidden = !text;
}
if (typeof document !== 'undefined') updateIntroStats();
