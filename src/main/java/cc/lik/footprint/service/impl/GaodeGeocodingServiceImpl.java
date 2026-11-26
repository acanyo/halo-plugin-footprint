package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.LocatedGeoInfo;
import cc.lik.footprint.service.GaodeGeocodingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.Exceptions;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.concurrent.TimeoutException;
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
    private static final Duration HTTP_TIMEOUT = Duration.ofSeconds(8);
    private static final int RETRY_COUNT = 2;
    private static final int RATE_LIMIT_RETRY_COUNT = 2;

    /** 省级行政区之后的地级市，如“浙江省杭州市”中的“杭州市”。 */
    private static final Pattern CITY_AFTER_PROVINCE =
        Pattern.compile(
            "(?:省|自治区|特别行政区)([\\u4e00-\\u9fa5]{1,8}?(?:市|自治州|地区|盟))"
        );

    /** 地址直接以城市开头，如“杭州市西湖区”。 */
    private static final Pattern CITY_AT_START =
        Pattern.compile("^([\\u4e00-\\u9fa5]{1,8}?(?:市|自治州|地区|盟))");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final WebClient webClient = WebClient.builder()
        .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(1024 * 1024))
        .build();

    @Override
    public Mono<String> locate(String address, String webKey) {
        return locateWithGeoInfo(address, webKey)
            .map(info -> info.getLongitude() + "," + info.getLatitude());
    }

    @Override
    public Mono<LocatedGeoInfo> locateWithGeoInfo(String address, String webKey) {
        // 足迹地址通常包含"园区/商场内的具体 POI"，优先使用 POI 关键字搜索，
        // 其结果更接近高德地图搜索和坐标拾取器展示的位置。
        return searchPoi(address, webKey)
            .switchIfEmpty(Mono.defer(() -> {
                log.info("POI关键字未找到结果，降级使用地理编码: {}", address);
                return geocode(address, webKey);
            }))
            .switchIfEmpty(Mono.error(new RuntimeException("无法根据地址获取经纬度")));
    }

    private Mono<LocatedGeoInfo> searchPoi(String address, String webKey) {
        String region = extractCity(address);
        return withQpsRetry(withTransportPolicy(webClient
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
                .bodyToMono(String.class))
            .map(this::parsePoiResponse))
            .onErrorResume(e -> {
                if (isGaodeApiFailure(e)) {
                    return Mono.error(e);
                }
                log.warn("调用高德POI搜索失败，将使用地理编码兜底: {}", e.getMessage());
                return Mono.empty();
            });
    }

    private Mono<LocatedGeoInfo> geocode(String address, String webKey) {
        return withQpsRetry(withTransportPolicy(webClient
                .get()
                .uri(GEOCODE_URL, uriBuilder -> uriBuilder
                    .queryParam("key", webKey)
                    .queryParam("address", address)
                    .queryParam("output", "json")
                    .build())
                .retrieve()
                .bodyToMono(String.class))
            .map(this::parseGeocodeResponse))
            .onErrorResume(e -> {
                if (isGaodeApiFailure(e)) {
                    return Mono.error(e);
                }
                log.error("调用高德地理编码API失败: {}", e.getMessage());
                return Mono.empty();
            });
    }

    @Override
    public Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String webKey) {
        String location = longitude + "," + latitude;
        return withQpsRetry(withTransportPolicy(webClient
                .get()
                .uri(REGEO_URL, uriBuilder -> uriBuilder
                    .queryParam("key", webKey)
                    .queryParam("location", location)
                    .queryParam("extensions", "base")
                    .build())
                .retrieve()
                .bodyToMono(String.class))
            .mapNotNull(this::parseReverseGeocode))
            .onErrorResume(e -> {
                if (isGaodeApiFailure(e)) {
                    return Mono.error(e);
                }
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
                throw gaodeApiException(json, "高德逆地理编码失败");
            }
            JsonNode regeocode = json.path("regeocode");
            JsonNode addressComponent = regeocode.path("addressComponent");
            if (addressComponent.isMissingNode()) {
                return null;
            }

            GeoInfo geoInfo = new GeoInfo();
            geoInfo.setAddress(resolveFormattedAddress(regeocode, addressComponent));
            geoInfo.setProvince(resolveProvince(addressComponent));
            geoInfo.setCity(resolveCity(addressComponent));
            applyAdcodes(addressComponent.path("adcode").asText(), geoInfo);
            return geoInfo;
        } catch (GaodeApiException e) {
            throw e;
        } catch (Exception e) {
            log.error("解析逆地理编码响应失败: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 优先使用高德返回的格式化地址；字段缺失时用省、市、区县、街道拼一个兜底值。
     */
    private String resolveFormattedAddress(JsonNode regeocode, JsonNode addressComponent) {
        JsonNode formatted = regeocode.path("formatted_address");
        if (formatted.isTextual() && !formatted.asText().isBlank()) {
            return formatted.asText();
        }
        if (formatted.isArray()) {
            StringBuilder joined = new StringBuilder();
            formatted.forEach(item -> {
                if (item.isTextual() && !item.asText().isBlank()) {
                    joined.append(item.asText());
                }
            });
            if (!joined.isEmpty()) {
                return joined.toString();
            }
        }
        JsonNode streetNumber = addressComponent.path("streetNumber");
        return java.util.stream.Stream.of(
                resolveProvince(addressComponent),
                resolveCity(addressComponent),
                addressComponent.path("district").asText(""),
                addressComponent.path("township").asText(""),
                streetNumber.path("street").asText(""),
                streetNumber.path("number").asText("")
            )
            .filter(value -> value != null && !value.isBlank())
            .distinct()
            .collect(java.util.stream.Collectors.joining());
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

    private void applyAdcodes(String adcode, LocatedGeoInfo geoInfo) {
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

    private LocatedGeoInfo parsePoiResponse(String response) {
        try {
            JsonNode json = parseGaodeResponse(response, "高德POI搜索失败");
            JsonNode pois = json.path("pois");
            if (!pois.isArray() || pois.isEmpty()) {
                throw new RuntimeException("高德POI搜索没有匹配结果");
            }
            JsonNode poi = pois.get(0);
            LocatedGeoInfo info = parseLocatedGeoInfo(poi);
            if (info == null) {
                throw new RuntimeException("高德POI搜索没有有效坐标");
            }
            info.setProvince(textValue(poi.path("pname")));
            info.setCity(resolvePoiCity(poi, info.getProvince()));
            applyAdcodes(textValue(poi.path("adcode")), info);
            return info;
        } catch (GaodeApiException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("解析高德POI搜索响应失败: " + e.getMessage(), e);
        }
    }

    private LocatedGeoInfo parseGeocodeResponse(String response) {
        try {
            JsonNode json = parseGaodeResponse(response, "高德地理编码失败");
            JsonNode geocodes = json.path("geocodes");
            if (!geocodes.isArray() || geocodes.isEmpty()) {
                throw new RuntimeException("高德地理编码没有匹配结果");
            }
            JsonNode geocode = geocodes.get(0);
            LocatedGeoInfo info = parseLocatedGeoInfo(geocode);
            if (info == null) {
                throw new RuntimeException("高德地理编码没有有效坐标");
            }
            info.setProvince(textValue(geocode.path("province")));
            info.setCity(textValue(geocode.path("city")));
            if (info.getCity() == null || info.getCity().isBlank()) {
                info.setCity(textValue(geocode.path("district")));
            }
            applyAdcodes(textValue(geocode.path("adcode")), info);
            return info;
        } catch (GaodeApiException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("解析高德地理编码响应失败: " + e.getMessage(), e);
        }
    }

    private JsonNode parseGaodeResponse(String response, String failurePrefix) throws Exception {
        JsonNode json = objectMapper.readTree(response);
        if (!"1".equals(json.path("status").asText())) {
            throw gaodeApiException(json, failurePrefix);
        }
        return json;
    }

    private GaodeApiException gaodeApiException(JsonNode json, String failurePrefix) {
        String info = json.path("info").asText("未知错误");
        String infoCode = json.path("infocode").asText("");
        String code = (info + " " + infoCode).trim();
        return GaodeApiException.from(code, failurePrefix + ": " + info);
    }

    private LocatedGeoInfo parseLocatedGeoInfo(JsonNode node) {
        String location = textValue(node.path("location"));
        if (location == null || !location.contains(",")) {
            return null;
        }
        try {
            double[] coordinates = FootprintImportSupport.parseLocation(location);
            LocatedGeoInfo info = new LocatedGeoInfo();
            info.setLongitude(coordinates[0]);
            info.setLatitude(coordinates[1]);
            return info;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private String resolvePoiCity(JsonNode poi, String province) {
        String city = textValue(poi.path("cityname"));
        if (city != null && !city.isBlank()) {
            return city;
        }
        if (province != null && !province.isBlank()) {
            return province;
        }
        return textValue(poi.path("adname"));
    }

    private String textValue(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                String value = textValue(item);
                if (value != null && !value.isBlank()) {
                    return value;
                }
            }
            return null;
        }
        String value = node.asText("").trim();
        return value.isEmpty() ? null : value;
    }

    private <T> Mono<T> withTransportPolicy(Mono<T> request) {
        return request
            .timeout(HTTP_TIMEOUT)
            .retryWhen(Retry.backoff(RETRY_COUNT, Duration.ofMillis(300))
                .filter(this::isRetryable)
                .maxBackoff(Duration.ofSeconds(2)));
    }

    private <T> Mono<T> withQpsRetry(Mono<T> request) {
        return request.retryWhen(Retry.fixedDelay(
                RATE_LIMIT_RETRY_COUNT,
                Duration.ofSeconds(1)
            )
            .filter(this::isRateLimitFailure)
            .onRetryExhaustedThrow((spec, signal) -> signal.failure()));
    }

    private boolean isRetryable(Throwable error) {
        Throwable cause = Exceptions.unwrap(error);
        return cause instanceof WebClientRequestException
            || cause instanceof TimeoutException
            || (cause instanceof WebClientResponseException response
                && response.getStatusCode().is5xxServerError());
    }

    private boolean isRateLimitFailure(Throwable error) {
        Throwable cause = Exceptions.unwrap(error);
        return cause instanceof GaodeApiException apiException
            && apiException.isRateLimit();
    }

    private boolean isGaodeApiFailure(Throwable error) {
        return Exceptions.unwrap(error) instanceof GaodeApiException;
    }

    static String extractCity(String address) {
        if (address == null || address.isBlank()) {
            return null;
        }
        String value = address.trim();
        Matcher afterProvince = CITY_AFTER_PROVINCE.matcher(value);
        if (afterProvince.find()) {
            return afterProvince.group(1);
        }
        Matcher atStart = CITY_AT_START.matcher(value);
        return atStart.find() ? atStart.group(1) : null;
    }
}
