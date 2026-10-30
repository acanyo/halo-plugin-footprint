import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../../main/frontend/travel-memory/modules/coordinate.js';

// 天安门（WGS84）及其 GCJ-02 公认值，算法与 coordtransform 同款
const TIANANMEN_WGS = { lng: 116.391305, lat: 39.907284 };

test('国内坐标偏移量级约几百米', () => {
    const g = wgs84ToGcj02(TIANANMEN_WGS.lng, TIANANMEN_WGS.lat);
    const dLng = (g.lng - TIANANMEN_WGS.lng) * 85000;   // 北纬 40° 每经度约 85 km
    const dLat = (g.lat - TIANANMEN_WGS.lat) * 111000;
    const meters = Math.hypot(dLng, dLat);
    assert.ok(meters > 300 && meters < 800, `偏移 ${meters.toFixed(0)} 米`);
});

test('往返误差亚米级', () => {
    for (const p of [TIANANMEN_WGS, { lng: 121.4737, lat: 31.2304 }, { lng: 113.2644, lat: 23.1291 }, { lng: 87.6168, lat: 43.8256 }]) {
        const g = wgs84ToGcj02(p.lng, p.lat);
        const back = gcj02ToWgs84(g.lng, g.lat);
        assert.ok(Math.abs(back.lng - p.lng) < 1e-5 && Math.abs(back.lat - p.lat) < 1e-5,
            `${p.lng},${p.lat} → ${back.lng},${back.lat}`);
    }
});

test('海外坐标原样返回', () => {
    assert.deepEqual(wgs84ToGcj02(139.6917, 35.6895), { lng: 139.6917, lat: 35.6895 });   // 东京
    assert.deepEqual(gcj02ToWgs84(-0.1276, 51.5072), { lng: -0.1276, lat: 51.5072 });     // 伦敦
});
