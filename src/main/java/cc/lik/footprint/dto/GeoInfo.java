package cc.lik.footprint.dto;

import lombok.Data;

@Data
public class GeoInfo {
    /** 高德逆地理编码返回的完整格式化地址 */
    private String address;
    private String province;
    private String city;
    private String provinceAdcode;
    private String cityAdcode;
}
