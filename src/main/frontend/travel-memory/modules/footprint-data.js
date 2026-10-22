/**
 * 足迹数据加载与统计区文案。
 *
 * 数据只有两个来源：模板注入的 window.FOOTPRINT_CONFIG.footprints，以及空数组。
 * 不内置任何兜底样例 —— 没有数据就老实显示空状态。
 *
 * 数组引用刻意保持不变（原地 length/push 更新），主文件里那些 `() => FOOTPRINTS`
 * 取值函数因此不需要改成快照重取。
 */

let dataReady = false;   // 首次加载是否已完成（含「确实为空」）

/** 足迹数组（引用稳定，内容原地更新）。 */
export const FOOTPRINTS = [];

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
        createTime: formatTestDate(s.createTime),
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
        galleryImages: (s.galleryImages || []).map(g => ({ url: g.url, caption: '' }))
    };
}

// createTime 兼容两种格式：test.json 的 "01/05/2026 01:04:00"（MM/DD/YYYY）与
// FOOTPRINT_CONFIG 注入的 ISO 格式 "2026-01-05T01:04:00Z"，统一转成 YYYY-MM-DD
function formatTestDate(str) {
    if (!str) return '';
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(str);
    if (m) return m[3] + '-' + m[1] + '-' + m[2];
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : str;
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

// 用加载到的数据替换足迹数组（保持数组引用不变，各处引用自动生效）
export function applyFootprints(loaded) {
    if (!Array.isArray(loaded)) return false;
    FOOTPRINTS.length = 0;
    FOOTPRINTS.push(...loaded);
    return true;
}

// 统计区：总足迹数 / 去过的城市数（数据驱动）
export function updateIntroStats() {
    const total = document.getElementById('introTotal');
    const cities = document.getElementById('introCities');
    if (total) total.textContent = FOOTPRINTS.length;
    if (cities) cities.textContent = new Set(FOOTPRINTS.map(f => f.city).filter(Boolean)).size;
}
updateIntroStats();
