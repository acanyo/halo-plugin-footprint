/**
 * 省份数据：边界几何索引（命中判定）+ 轮廓实体索引（选中高亮）。
 *
 * 从 province-cards.js 拆出，不依赖任何宿主注入，全是数据与几何：
 *   - china-full.json 的共享请求、按 adcode 建的边界索引、射线法命中判定；
 *   - 中国轮廓加载后按 adcode 归组的实体表，以及「改材质 + 按引用还原」的省份高亮。
 *
 * 省面的填充是 alpha=0（Cesium 的拾取通道会直接丢弃这类片元），
 * 所以命中判定只能走几何计算（pointInRing / pointInProvince）。
 */

const PROVINCE_GEOJSON_URL = '/plugins/footprint/assets/static/data/china-full.json';
// 与「城市高亮」同源的琥珀金：整套选中态只有一种颜色
const PROVINCE_HL_FILL = 'rgba(255, 176, 103, 0.12)';
const PROVINCE_HL_STROKE = '#FFB067';
const PROVINCE_HL_STROKE_WIDTH = 1.4;

let provinceHighlightAdcode = '';   // 当前高亮的省份（材质改写）
let provinceEntityMap = null;       // Map<adcode, Entity[]>，中国轮廓加载完成后建立
let provinceMaterialSnapshot = null;// Map<Entity, { fill, stroke, width }>，用于还原
let provinceIndex = null;           // Map<adcode, { name, center, bbox, polygons }>
let provinceIndexPromise = null;
let provinceGeoJsonPromise = null;  // china-full.json 的共享请求，见 loadProvinceGeoJson

// ---------- 省份边界 GeoJSON（共享请求） ----------
// 这份 208 KB 的 china-full.json 有两个消费方：画轮廓的 GeoJsonDataSource，
// 和点省份时做几何判定的索引。两边原来各自发一次请求，且一个走 Cesium 的
// Resource、一个走 fetch，几乎同时发出谁也命中不了对方的缓存，
// 结果同一份文件在首屏下载两次（实测 208 KB × 2）。这里收敛成一次。
export function loadProvinceGeoJson() {
    if (!provinceGeoJsonPromise) {
        provinceGeoJsonPromise = fetch(PROVINCE_GEOJSON_URL, { referrerPolicy: 'no-referrer' })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .catch(e => {
                provinceGeoJsonPromise = null;   // 失败允许下次重试
                throw e;
            });
    }
    return provinceGeoJsonPromise;
}

// ---------- 省份边界索引（几何判定用） ----------
export function loadProvinceIndex() {
    if (!provinceIndexPromise) {
        provinceIndexPromise = loadProvinceGeoJson()
            .then(geojson => {
                provinceIndex = buildProvinceIndex(geojson);
                return provinceIndex;
            })
            .catch(e => {
                provinceIndexPromise = null;   // 失败允许下次重试
                console.warn('省份边界索引导入失败：', e);
                return null;
            });
    }
    return provinceIndexPromise;
}

function buildProvinceIndex(geojson) {
    const index = new Map();
    const features = (geojson && geojson.features) || [];
    features.forEach(feature => {
        const props = (feature && feature.properties) || {};
        const adcode = String(props.adcode || '').trim();
        const geometry = feature && feature.geometry;
        // 只收省级编码（6 位纯数字）；南海诸岛那个空名分区（100000_JD）直接排除
        if (!geometry || !/^\d{6}$/.test(adcode)) return;
        const polygons = ringSetsOfGeometry(geometry);
        if (!polygons.length) return;
        index.set(adcode, {
            adcode: adcode,
            name: String(props.name || ''),
            center: Array.isArray(props.center) ? props.center : null,
            bbox: bboxOfPolygons(polygons),
            polygons: polygons
        });
    });
    return index;
}

// Polygon / MultiPolygon → [{ outer, holes }]，坐标摊平成 [lng, lat, ...] 的 Float64Array
function ringSetsOfGeometry(geometry) {
    const type = geometry.type;
    const coords = geometry.coordinates || [];
    const polygons = type === 'Polygon' ? [coords] : (type === 'MultiPolygon' ? coords : []);
    const out = [];
    polygons.forEach(rings => {
        if (!Array.isArray(rings) || !rings.length) return;
        const outer = flattenRing(rings[0]);
        if (!outer || outer.length < 6) return;
        const holes = [];
        for (let i = 1; i < rings.length; i++) {
            const hole = flattenRing(rings[i]);
            if (hole && hole.length >= 6) holes.push(hole);
        }
        out.push({ outer: outer, holes: holes });
    });
    return out;
}

function flattenRing(ring) {
    if (!Array.isArray(ring) || !ring.length) return null;
    const flat = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
        const point = ring[i];
        if (!Array.isArray(point)) return null;
        flat[i * 2] = Number(point[0]);
        flat[i * 2 + 1] = Number(point[1]);
    }
    return flat;
}

function bboxOfPolygons(polygons) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    polygons.forEach(set => {
        const ring = set.outer;
        for (let i = 0; i < ring.length; i += 2) {
            const lng = ring[i];
            const lat = ring[i + 1];
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    });
    return [minLng, minLat, maxLng, maxLat];
}

// 射线法：环是闭合折线，首尾点重复与否都不影响结果
function pointInRing(lng, lat, ring) {
    let inside = false;
    const count = ring.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i++) {
        const xi = ring[i * 2], yi = ring[i * 2 + 1];
        const xj = ring[j * 2], yj = ring[j * 2 + 1];
        if ((yi > lat) !== (yj > lat) &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

export function pointInProvince(lng, lat) {
    if (!provinceIndex) return null;
    for (const info of provinceIndex.values()) {
        const b = info.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        for (let i = 0; i < info.polygons.length; i++) {
            const set = info.polygons[i];
            if (!pointInRing(lng, lat, set.outer)) continue;
            let inHole = false;
            for (let h = 0; h < set.holes.length; h++) {
                if (pointInRing(lng, lat, set.holes[h])) { inHole = true; break; }
            }
            if (!inHole) return info;
        }
    }
    return null;
}

export function provinceAdcodeOfEntity(entity) {
    const props = entity && entity.properties;
    if (!props) return '';
    const raw = props.adcode;
    if (!raw) return '';
    const value = typeof raw.getValue === 'function' ? raw.getValue(Cesium.JulianDate.now()) : raw;
    return value ? String(value) : '';
}

// 省级编码直接命中；城市级编码（城市高亮图层的面）按前两位反推省级编码
export function provinceInfoByAdcode(adcode, allowCity) {
    if (!provinceIndex || !adcode) return null;
    const direct = provinceIndex.get(String(adcode));
    if (direct) return direct;
    if (allowCity && /^\d{6}$/.test(String(adcode))) {
        return provinceIndex.get(String(adcode).slice(0, 2) + '0000') || null;
    }
    return null;
}

/** 当前的边界索引；还没加载完（或加载失败）时为 null。 */
export function currentProvinceIndex() {
    return provinceIndex;
}

export function normalizeProvinceName(value) {
    return String(value || '')
        .replace(/\s/g, '')
        .replace(/(省|市)$/, '')
        .replace(/特别行政区$/, '')
        .replace(/自治区$/, '')
        .replace(/(维吾尔|壮族|回族|藏族)$/, '');
}

export function provinceLabelWorldFromInfo(info) {
    // 标注落在省份中心：优先用 DataV 的 center（人工校正过，多岛屿省份不会被拉偏），
    // 没有 center 时退回几何包围盒中心。
    let lng = null;
    let lat = null;
    if (info.center && info.center.length >= 2) {
        lng = Number(info.center[0]);
        lat = Number(info.center[1]);
    } else if (info.bbox) {
        lng = (info.bbox[0] + info.bbox[2]) / 2;
        lat = (info.bbox[1] + info.bbox[3]) / 2;
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return Cesium.Cartesian3.fromDegrees(lng, lat, 0);
}

// ---------- 省份高亮（材质改写 + 记录原值还原） ----------
export function applyProvinceHighlight(adcode) {
    const next = adcode ? String(adcode) : '';
    if (next === provinceHighlightAdcode) return;
    if (provinceMaterialSnapshot) {
        provinceMaterialSnapshot.forEach((saved, entity) => {
            if (entity.polygon && saved.fill) entity.polygon.material = saved.fill;
            if (entity.polyline && saved.stroke) entity.polyline.material = saved.stroke;
            if (entity.polyline && saved.width) entity.polyline.width = saved.width;
        });
    }
    provinceHighlightAdcode = next;
    if (!next || !provinceEntityMap) return;
    const entities = provinceEntityMap.get(next);
    if (!entities || !entities.length) return;
    // 每个实体单独赋新材质：所有实体最初共享同一个材质实例，改实例等于全省份一起变
    const fill = Cesium.Color.fromCssColorString(PROVINCE_HL_FILL);
    const stroke = Cesium.Color.fromCssColorString(PROVINCE_HL_STROKE);
    entities.forEach(entity => {
        if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(fill);
        if (entity.polyline) {
            entity.polyline.material = new Cesium.ColorMaterialProperty(stroke);
            entity.polyline.width = PROVINCE_HL_STROKE_WIDTH;
        }
    });
}

/**
 * 中国轮廓加载完成后，把按 adcode 归组的省份实体交给本模块。
 * 轮廓的加载本身仍在主文件（它同时决定了边界显隐与城市填充），
 * 这里只接管「省份高亮需要的两张索引表」。
 */
export function setProvinceEntityIndex(entityMap, materialSnapshot) {
    provinceEntityMap = entityMap;
    provinceMaterialSnapshot = materialSnapshot;
}
