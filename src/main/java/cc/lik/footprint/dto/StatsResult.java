package cc.lik.footprint.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StatsResult {
    private long totalFootprints;
    private long totalProvinces;
    private long totalCities;
    private List<ProvinceStat> provinces;
    private List<CityStat> cities;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProvinceStat {
        private String name;
        private String adcode;
        private long count;
        private List<String> cities;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CityStat {
        private String name;
        private String adcode;
        private String province;
        private String provinceAdcode;
        private long count;
    }
}
