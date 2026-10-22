package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.service.GaodeGeocodingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 高德地理编码。
 *
 * <p>三处查询共用「调接口 → 判 status → 取 location/adcode」这套流程，
 * 但失败语义不同，所以没有强行合并：</p>
 * <ul>
 *   <li>正向（POI / 地理编码）：查不到就返回空，交给 {@link #locate} 决定降级，
 *       两者都空才报错 —— 用户填的地址可能很模糊，能用别的路径命中就别失败；</li>
 *   <li>逆向：查不到同样返回空，由调用方决定是「提示用户手动修正」还是「静默跳过」。</li>
 * </ul>
 */
@Component
@Slf4j
public class GaodeGeocodingServiceImpl implements GaodeGeocodingService {

    private static final String GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo";
    private static final String POI_URL = "https://restapi.amap.com/v5/place/text";
    private static final String REGEO_URL = "https://restapi.amap.com/v3/geocode/regeo";

    /** 从中文地址里粗略提取城市名，用于给 POI 搜索加 region 限定。 */
    private static final Pattern CITY_PATTERN =
        Pattern.compile("([\\u4e00-\\u9fa5]{1,12}(?:市|自治州|地区|盟))");

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public Mono<String> locate(String address, String webKey) {
        // 足迹地址通常包含"园区/商场内的具体 POI"，优先使用 POI 关键字搜索，
        // 其结果更接近高德地图搜索和坐标拾取器展示的位置。
        return searchPoi(address, webKey)
            .switchIfEmpty(Mono.defer(() -> {
                log.info("POI关键字未找到结果，降级使用地理编码: {}", address);
                return geocode(address, webKey);
            }))
            .switchIfEmpty(Mono.error(new RuntimeException("无法根据地址获取经纬度")));
    }

    private Mono<String> searchPoi(String address, String webKey) {
        String region = extractCity(address);
        return WebClient.create()
            .get()
            .uri(POI_URL, uriBuilder -> {
                uriBuilder
                    .queryParam("key", webKey)
                    .queryParam("keywords", address)
                    .queryParam("output", "json")
                    .queryParam("page_size", 1);
                if (region != null) {
                    uriBuilder.queryParam("region", region)
                        .queryParam("city_limit", "true");
                }
                return uriBuilder.build();
            })
            .retrieve()
            .bodyToMono(String.class)
            .map(response -> {
                try {
                    JsonNode json = objectMapper.readTree(response);
                    if (!"1".equals(json.path("status").asText())) {
                        throw new RuntimeException("高德POI搜索失败: "
                            + json.path("info").asText("未知错误"));
                    }
                    String location = extractFirstLocation(json.path("pois"));
                    if (location == null) {
                        throw new RuntimeException("高德POI搜索没有匹配结果");
                    }
                    return location;
                } catch (Exception e) {
                    throw new RuntimeException("解析高德POI搜索响应失败: " + e.getMessage(), e);
                }
            })
            .onErrorResume(e -> {
                log.warn("调用高德POI搜索失败，将使用地理编码兜底: {}", e.getMessage());
                return Mono.empty();
            });
    }

    private Mono<String> geocode(String address, String webKey) {
        return WebClient.create()
            .get()
            .uri(GEOCODE_URL, uriBuilder -> uriBuilder
                .queryParam("key", webKey)
                .queryParam("address", address)
                .queryParam("output", "json")
                .build())
            .retrieve()
            .bodyToMono(String.class)
            .map(response -> {
                try {
                    JsonNode json = objectMapper.readTree(response);
                    if (!"1".equals(json.path("status").asText())) {
                        throw new RuntimeException("高德地理编码失败: "
                            + json.path("info").asText("未知错误"));
                    }
                    String location = extractFirstLocation(json.path("geocodes"));
                    if (location == null) {
                        throw new RuntimeException("高德地理编码没有匹配结果");
                    }
                    return location;
                } catch (Exception e) {
                    throw new RuntimeException("解析高德地理编码响应失败: " + e.getMessage(), e);
                }
            })
            .onErrorResume(e -> {
                log.error("调用高德地理编码API失败: {}", e.getMessage());
                return Mono.empty();
            });
    }

    @Override
    public Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String webKey) {
        String location = longitude + "," + latitude;
        return WebClient.create()
            .get()
            .uri(REGEO_URL, uriBuilder -> uriBuilder
                .queryParam("key", webKey)
                .queryParam("location", location)
                .queryParam("extensions", "base")
                .build())
            .retrieve()
            .bodyToMono(String.class)
            .mapNotNull(this::parseReverseGeocode)
            .onErrorResume(e -> {
                log.error("调用高德逆地理编码API失败: {}", e.getMessage());
                return Mono.empty();
            });
    }

    /**
     * 解析逆地理编码响应；任何字段层面的异常都返回 null 而不是抛错 ——
     * 高德偶尔会返回缺字段的响应，调用方按「解析失败」统一处理即可。
     */
    private GeoInfo parseReverseGeocode(String response) {
        try {
            JsonNode json = objectMapper.readTree(response);
            if (!"1".equals(json.path("status").asText())) {
                log.warn("逆地理编码失败: {}", json.path("info").asText());
                return null;
            }
            JsonNode addressComponent = json.path("regeocode").path("addressComponent");
            if (addressComponent.isMissingNode()) {
                return null;
            }

            GeoInfo geoInfo = new GeoInfo();
            geoInfo.setProvince(resolveProvince(addressComponent));
            geoInfo.setCity(resolveCity(addressComponent));
            applyAdcodes(addressComponent.path("adcode").asText(), geoInfo);
            return geoInfo;
        } catch (Exception e) {
            log.error("解析逆地理编码响应失败: {}", e.getMessage());
            return null;
        }
    }

    /** 直辖市时 province 可能为空，此时退到 city。 */
    private String resolveProvince(JsonNode addressComponent) {
        String province = addressComponent.path("province").asText();
        return province.isEmpty() ? addressComponent.path("city").asText() : province;
    }

    /** 直辖市时 city 可能为空，此时退到 district。 */
    private String resolveCity(JsonNode addressComponent) {
        String city = addressComponent.path("city").asText();
        return city.isEmpty() ? addressComponent.path("district").asText() : city;
    }

    /**
     * 高德返回的 adcode 是区县级（如 440305），转成足迹数据使用的省/市级：
     * 省级取前 2 位 + 0000，市级取前 4 位 + 00。
     */
    private void applyAdcodes(String adcode, GeoInfo geoInfo) {
        if (adcode == null || adcode.isEmpty()) {
            return;
        }
        if (adcode.length() >= 2) {
            geoInfo.setProvinceAdcode(adcode.substring(0, 2) + "0000");
        }
        if (adcode.length() >= 4) {
            geoInfo.setCityAdcode(adcode.substring(0, 4) + "00");
        } else {
            geoInfo.setCityAdcode(adcode);
        }
    }

    private String extractFirstLocation(JsonNode results) {
        if (results == null || !results.isArray() || results.isEmpty()) {
            return null;
        }
        JsonNode locationNode = results.get(0).path("location");
        if (!locationNode.isTextual()) {
            return null;
        }
        String location = locationNode.asText().trim();
        String[] coordinates = location.split(",");
        if (coordinates.length != 2) {
            return null;
        }
        try {
            Double.parseDouble(coordinates[0]);
            Double.parseDouble(coordinates[1]);
            return coordinates[0].trim() + "," + coordinates[1].trim();
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String extractCity(String address) {
        if (address == null || address.isBlank()) {
            return null;
        }
        Matcher matcher = CITY_PATTERN.matcher(address);
        return matcher.find() ? matcher.group(1) : null;
    }
}
