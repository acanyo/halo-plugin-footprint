package cc.lik.footprint.stats;

import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FootprintStatsAggregatorTest {

    private static Footprint footprint(String province, String provinceAdcode,
        String city, String cityAdcode) {
        Footprint fp = new Footprint();
        Footprint.FootprintSpec spec = new Footprint.FootprintSpec();
        spec.setProvince(province);
        spec.setProvinceAdcode(provinceAdcode);
        spec.setCity(city);
        spec.setCityAdcode(cityAdcode);
        fp.setSpec(spec);
        return fp;
    }

    @Test
    @DisplayName("空列表返回全零，不抛异常")
    void aggregateEmpty() {
        StatsResult result = FootprintStatsAggregator.aggregate(List.of());
        assertThat(result.getTotalFootprints()).isZero();
        assertThat(result.getTotalProvinces()).isZero();
        assertThat(result.getTotalCities()).isZero();
        assertThat(result.getProvinces()).isEmpty();
        assertThat(result.getCities()).isEmpty();
    }

    @Test
    @DisplayName("同一省份多条足迹累加计数，城市名只列一次")
    void aggregateProvinceCounts() {
        StatsResult result = FootprintStatsAggregator.aggregate(List.of(
            footprint("广东", "440000", "深圳", "440300"),
            footprint("广东", "440000", "深圳", "440300"),
            footprint("广东", "440000", "广州", "440100")
        ));

        assertThat(result.getTotalFootprints()).isEqualTo(3);
        assertThat(result.getTotalProvinces()).isEqualTo(1);
        assertThat(result.getTotalCities()).isEqualTo(2);

        StatsResult.ProvinceStat guangdong = result.getProvinces().get(0);
        assertThat(guangdong.getName()).isEqualTo("广东");
        assertThat(guangdong.getCount()).isEqualTo(3);
        assertThat(guangdong.getCities()).containsExactly("深圳", "广州");
    }

    @Test
    @DisplayName("区县级 adcode 归一化为市级，避免同一城市被拆成多个")
    void normalizeDistrictAdcode() {
        StatsResult result = FootprintStatsAggregator.aggregate(List.of(
            // 440305 = 南山区，440300 = 深圳市，两条应归为同一个城市
            footprint("广东", "440000", "深圳", "440305"),
            footprint("广东", "440000", "深圳", "440300")
        ));

        assertThat(result.getTotalCities()).isEqualTo(1);
        assertThat(result.getCities().get(0).getAdcode()).isEqualTo("440300");
        assertThat(result.getCities().get(0).getCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("按足迹数降序排列")
    void aggregateSortsByCount() {
        StatsResult result = FootprintStatsAggregator.aggregate(List.of(
            footprint("广东", "440000", "深圳", "440300"),
            footprint("浙江", "330000", "杭州", "330100"),
            footprint("浙江", "330000", "杭州", "330100"),
            footprint("浙江", "330000", "宁波", "330200")
        ));

        assertThat(result.getProvinces())
            .extracting(StatsResult.ProvinceStat::getName)
            .containsExactly("浙江", "广东");
        assertThat(result.getCities())
            .extracting(StatsResult.CityStat::getName)
            .containsExactly("杭州", "深圳", "宁波");
    }

    @Test
    @DisplayName("adcode 缺失的足迹只计入总数，不产生省份/城市条目")
    void aggregateSkipsMissingAdcode() {
        StatsResult result = FootprintStatsAggregator.aggregate(List.of(
            footprint("未知", "", "未知", ""),
            footprint(null, null, null, null),
            footprint("广东", "440000", "深圳", "440300")
        ));

        assertThat(result.getTotalFootprints()).isEqualTo(3);
        assertThat(result.getTotalProvinces()).isEqualTo(1);
        assertThat(result.getTotalCities()).isEqualTo(1);
    }

    @Test
    @DisplayName("spec 为空或列表里混入 null 时不抛异常")
    void aggregateToleratesDirtyData() {
        Footprint noSpec = new Footprint();
        noSpec.setSpec(null);

        List<Footprint> footprints = new ArrayList<>();
        footprints.add(noSpec);
        footprints.add(null);
        footprints.add(footprint("广东", "440000", "深圳", "440300"));

        StatsResult result = FootprintStatsAggregator.aggregate(footprints);
        assertThat(result.getTotalProvinces()).isEqualTo(1);
        assertThat(result.getTotalCities()).isEqualTo(1);
    }
}
