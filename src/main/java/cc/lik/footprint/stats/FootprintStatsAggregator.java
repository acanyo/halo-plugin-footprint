package cc.lik.footprint.stats;

import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 足迹统计的聚合口径。
 *
 * <p>纯函数，不碰数据库也不碰 Reactor —— 输入一组足迹，输出统计结果。
 * 抽成独立类是为了能直接写单元测试：口径最容易出错的地方（adcode 归一化、
 * 省份城市去重、排序）都不该只能靠起一个 Halo 实例来验证。</p>
 *
 * <p>两条归一化规则：</p>
 * <ul>
 *   <li>城市 adcode 统一成市级（前 4 位 + 00）。旧数据可能存的是区县级
 *       （440305），不归一化会把深圳市拆成好几个「城市」；</li>
 *   <li>省份下的城市名去重：同一城市多条足迹只列一次。</li>
 * </ul>
 */
public final class FootprintStatsAggregator {

    private FootprintStatsAggregator() {
    }

    /**
     * @param footprints 全部足迹，允许包含 spec 为空或 adcode 缺失的脏数据
     */
    public static StatsResult aggregate(List<Footprint> footprints) {
        Map<String, StatsResult.ProvinceStat> provinceMap = new LinkedHashMap<>();
        Map<String, StatsResult.CityStat> cityMap = new LinkedHashMap<>();

        for (Footprint footprint : footprints) {
            if (footprint == null) {
                continue;
            }
            Footprint.FootprintSpec spec = footprint.getSpec();
            if (spec == null) {
                continue;
            }
            collectProvince(spec, provinceMap);
            collectCity(spec, cityMap);
            linkCityToProvince(spec, provinceMap);
        }

        List<StatsResult.ProvinceStat> provinces = new ArrayList<>(provinceMap.values());
        provinces.sort(Comparator.comparing(StatsResult.ProvinceStat::getCount).reversed());

        List<StatsResult.CityStat> cities = new ArrayList<>(cityMap.values());
        cities.sort(Comparator.comparing(StatsResult.CityStat::getCount).reversed());

        return StatsResult.builder()
            .totalFootprints(footprints.size())
            .totalProvinces(provinceMap.size())
            .totalCities(cityMap.size())
            .provinces(provinces)
            .cities(cities)
            .build();
    }

    /** 把 cityAdcode 归一化为市级编码；不足 4 位时原样返回，缺失时返回 null。 */
    static String normalizeCityAdcode(String rawAdcode) {
        if (rawAdcode == null || rawAdcode.isEmpty()) {
            return null;
        }
        if (rawAdcode.length() >= 4) {
            return rawAdcode.substring(0, 4) + "00";
        }
        return rawAdcode;
    }

    private static void collectProvince(Footprint.FootprintSpec spec,
        Map<String, StatsResult.ProvinceStat> provinceMap) {
        String adcode = spec.getProvinceAdcode();
        if (isBlank(adcode)) {
            return;
        }
        StatsResult.ProvinceStat stat = provinceMap.computeIfAbsent(adcode, key ->
            StatsResult.ProvinceStat.builder()
                .adcode(key)
                .name(nullToEmpty(spec.getProvince()))
                .count(0)
                .cities(new ArrayList<>())
                .build());
        stat.setCount(stat.getCount() + 1);
    }

    private static void collectCity(Footprint.FootprintSpec spec,
        Map<String, StatsResult.CityStat> cityMap) {
        String adcode = normalizeCityAdcode(spec.getCityAdcode());
        if (isBlank(adcode)) {
            return;
        }
        StatsResult.CityStat stat = cityMap.computeIfAbsent(adcode, key ->
            StatsResult.CityStat.builder()
                .adcode(key)
                .name(nullToEmpty(spec.getCity()))
                .province(nullToEmpty(spec.getProvince()))
                .provinceAdcode(nullToEmpty(spec.getProvinceAdcode()))
                .count(0)
                .build());
        stat.setCount(stat.getCount() + 1);
    }

    private static void linkCityToProvince(Footprint.FootprintSpec spec,
        Map<String, StatsResult.ProvinceStat> provinceMap) {
        String provinceAdcode = spec.getProvinceAdcode();
        String cityName = spec.getCity();
        if (isBlank(provinceAdcode) || isBlank(cityName)) {
            return;
        }
        StatsResult.ProvinceStat province = provinceMap.get(provinceAdcode);
        if (province == null) {
            return;
        }
        List<String> cities = province.getCities();
        if (!cities.contains(cityName)) {
            cities.add(cityName);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isEmpty();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
