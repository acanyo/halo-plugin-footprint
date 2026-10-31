/**
 * 2D 地图上的统计面板（总数 / 省份 / 城市 / 分类）。
 */

// ===== 统计面板 =====
export function computeStats(footprints) {
    var adcodeSet = new Set();
    var citySet = new Set();
    var muniPx = ["11", "12", "31", "50"];
    var autoPx = ["15", "45", "54", "64", "65"];
    var sarPx = ["81", "82"];
    var m = 0, a = 0, s = 0, p = 0;

    footprints.forEach(function (fp) {
        var adc = fp.spec.provinceAdcode;
        if (!adc) return;
        var px = adc.substring(0, 2);
        if (!adcodeSet.has(adc)) {
            adcodeSet.add(adc);
            if (muniPx.indexOf(px) !== -1) m++;
            else if (autoPx.indexOf(px) !== -1) a++;
            else if (sarPx.indexOf(px) !== -1) s++;
            else p++;
        }
        if (fp.spec.cityAdcode) citySet.add(fp.spec.cityAdcode);
    });

    return {
        total: footprints.length,
        provinces: adcodeSet.size,
        cities: citySet.size,
        categories: [
            {label: "直辖市", v: m, t: 4},
            {label: "自治区", v: a, t: 5},
            {label: "特区", v: s, t: 2},
            {label: "省份", v: p, t: 23}
        ]
    };
}

export function renderStats() {
    var footprints = window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.footprints;
    if (!Array.isArray(footprints)) return;

    var stats = computeStats(footprints);
    var panel = document.getElementById("map-stats");
    if (!panel) return;

    document.getElementById("stats-total").textContent = stats.total;
    document.getElementById("stats-provinces").textContent = stats.provinces + " / 34";
    document.getElementById("stats-cities").textContent = stats.cities;

    var detail = document.getElementById("stats-detail");
    detail.innerHTML = "";
    stats.categories.forEach(function (cat) {
        var row = document.createElement("div");
        row.className = "stats-cat" + (cat.v === 0 ? " is-zero" : "");
        row.innerHTML = "<span class=\"stats-cat-label\">" + cat.label + "</span>" +
                "<span class=\"stats-cat-value\">" + cat.v + "/" + cat.t + "</span>";
        detail.appendChild(row);
    });

    panel.classList.add("show");
}
