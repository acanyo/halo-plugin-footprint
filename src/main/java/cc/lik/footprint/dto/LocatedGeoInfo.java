package cc.lik.footprint.dto;

import lombok.Data;

/**
 * 地址正向解析结果：坐标和行政区一次返回。
 */
@Data
public class LocatedGeoInfo {

    private Double longitude;

    private Double latitude;

    private String province;

    private String city;

    private String provinceAdcode;

    private String cityAdcode;
}
