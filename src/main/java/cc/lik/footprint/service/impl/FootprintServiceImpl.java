package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.ReactiveSettingFetcher;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Secret;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.*;
import java.util.stream.Collectors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@EnableScheduling
@AllArgsConstructor
@Slf4j
public class FootprintServiceImpl implements FootprintService {
    private final ReactiveSettingFetcher settingFetcher;
    private final ReactiveExtensionClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public Mono<BaseConfig> getConfigByGroupName() {
        return Mono.zip(
                fetchSetting("base")
                    .switchIfEmpty(Mono.error(new RuntimeException("配置不存在"))),
                fetchSetting("globe3d")
                    .defaultIfEmpty(objectMapper.createObjectNode()),
                fetchSetting("imageProcess")
                    .defaultIfEmpty(objectMapper.createObjectNode())
            )
            .map(tuple -> {
                JsonNode item = tuple.getT1();
                JsonNode globe = tuple.getT2();
                JsonNode image = tuple.getT3();
                return Mono.zip(
                    getSecretValue(item.path("gaoDeKeySecretName").asText()),
                    getSecretValue(item.path("gaoDeWebKeySecretName").asText())
                ).map(keys -> new BaseConfig(
                    item.path("title").asText("Handsome足迹"),
                    keys.getT1(),
                    keys.getT2(),
                    item.path("describe").asText("每一处足迹都充满了故事，那是对人生的思考和无限的风光。"),
                    item.path("hsla").asText("109,42%,60%"),
                    item.path("logoName").asText(),
                    item.path("mapStyle").asText(),
                    item.path("markerStyle").asText("pin"),
                    item.path("enableHoverZoom").asBoolean(true),
                    item.path("highlightScheme").asText("glow"),
                    item.path("highlightVisitedCities").asBoolean(true),
                    item.path("photoWallPageSize").asInt(6),
                    item.path("photoWallStyle").asText("original"),
                    globe.path("globeTitle").asText("旅行记忆"),
                    globe.path("globeDesc").asText("把每一次出发，收藏成地球上的坐标；让走过的城市，成为星空下的故事。"),
                    globe.path("tiandituKey").asText(""),
                    globe.path("enableTerrainDefault").asBoolean(false),
                    globe.path("ticketGalleryStyle").asText("fan"),
                    globe.path("ticketGalleryInfoStyle").asText("card"),
                    globe.path("mobileCityWallColumns").asInt(2),
                    globe.path("enableTimeCapsule").asBoolean(true),
                    globe.path("enableInsight").asBoolean(true),
                    globe.path("cityCardHoverCarousel").asBoolean(true),
                    globe.path("enablePostcard").asBoolean(true),
                    image.path("markerImageFrom").asText(""),
                    image.path("markerImageTo").asText(""),
                    image.path("markerImageSuffix").asText(""),
                    image.path("timelineImageFrom").asText(""),
                    image.path("timelineImageTo").asText(""),
                    image.path("timelineImageSuffix").asText(""),
                    image.path("cityWallImageFrom").asText(""),
                    image.path("cityWallImageTo").asText(""),
                    image.path("cityWallImageSuffix").asText(""),
                    globe.path("enableTicketJourneyReplay").asBoolean(false),
                    globe.path("enableTicketSeasonLight").asBoolean(false),
                    globe.path("enableTicketOracle").asBoolean(false),
                    globe.path("enableTicketLetter").asBoolean(false),
                    globe.path("enableTicketPassport").asBoolean(false),
                    globe.path("globeLabels").asText("all")
                ));
            })
            .flatMap(config -> config);
    }

    private Mono<ObjectNode> fetchSetting(String groupName) {
        return settingFetcher.fetch(groupName, Map.class)
            .map(values -> objectMapper.valueToTree(values));
    }

    private Mono<String> getSecretValue(String secretName) {
        if (secretName == null || secretName.isBlank()) {
            return Mono.just("");
        }
        return client.fetch(Secret.class, secretName)
            .switchIfEmpty(Mono.error(new IllegalStateException("未找到配置的 Secret: " + secretName)))
            .map(secret -> {
                Map<String, String> stringData = secret.getStringData();
                return stringData == null ? "" : stringData.getOrDefault("key", "");
            });
    }

    private static final String GAODE_URL = "https://restapi.amap.com/v3/geocode/geo";
    private static final String GAODE_POI_URL = "https://restapi.amap.com/v5/place/text";
    private static final String GAODE_REGEO_URL = "https://restapi.amap.com/v3/geocode/regeo";
    private static final Pattern CITY_PATTERN =
        Pattern.compile("([\\u4e00-\\u9fa5]{1,12}(?:市|自治州|地区|盟))");

    @Override
    public Mono<String> AddressLocationUtil(String address, String gaoDeWebKey) {
        // 足迹地址通常包含“园区/商场内的具体 POI”，优先使用 POI 关键字搜索，
        // 其结果更接近高德地图搜索和坐标拾取器展示的位置。
        return searchPoiLocation(address, gaoDeWebKey)
                .switchIfEmpty(Mono.defer(() -> {
                    log.info("POI关键字未找到结果，降级使用地理编码: {}", address);
                    return geocodeLocation(address, gaoDeWebKey);
                }))
                .switchIfEmpty(Mono.error(new RuntimeException("无法根据地址获取经纬度")));
    }

    private Mono<String> searchPoiLocation(String address, String gaoDeWebKey) {
        String region = extractCity(address);
        return WebClient.create()
                .get()
                .uri(GAODE_POI_URL, uriBuilder -> {
                    uriBuilder
                        .queryParam("key", gaoDeWebKey)
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
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if (!"1".equals(jsonResponse.path("status").asText())) {
                            throw new RuntimeException("高德POI搜索失败: "
                                    + jsonResponse.path("info").asText("未知错误"));
                        }
                        String location = extractFirstLocation(jsonResponse.path("pois"));
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

    private Mono<String> geocodeLocation(String address, String gaoDeWebKey) {
        return WebClient.create()
                .get()
                .uri(GAODE_URL, uriBuilder -> uriBuilder
                        .queryParam("key", gaoDeWebKey)
                        .queryParam("address", address)
                        .queryParam("output", "json")
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .map(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if (!"1".equals(jsonResponse.path("status").asText())) {
                            throw new RuntimeException("高德地理编码失败: "
                                    + jsonResponse.path("info").asText("未知错误"));
                        }
                        String location = extractFirstLocation(jsonResponse.path("geocodes"));
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

    @Override
    public Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String gaoDeWebKey) {
        String location = longitude + "," + latitude;
        return WebClient.create()
                .get()
                .uri(GAODE_REGEO_URL, uriBuilder -> uriBuilder
                        .queryParam("key", gaoDeWebKey)
                        .queryParam("location", location)
                        .queryParam("extensions", "base")
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .mapNotNull(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if (!"1".equals(jsonResponse.get("status").asText())) {
                            log.warn("逆地理编码失败: {}", jsonResponse.get("info").asText());
                            return null;
                        }
                        JsonNode regeocode = jsonResponse.get("regeocode");
                        if (regeocode == null) {
                            return null;
                        }
                        JsonNode addressComponent = regeocode.get("addressComponent");
                        if (addressComponent == null) {
                            return null;
                        }

                        GeoInfo geoInfo = new GeoInfo();

                        String province = addressComponent.get("province").asText();
                        // 直辖市时 province 可能为空字符串
                        if (province == null || province.isEmpty()) {
                            province = addressComponent.path("city").asText();
                        }
                        geoInfo.setProvince(province);

                        // 城市：取 city，如果为空则取 district（直辖市情况）
                        String city = addressComponent.get("city").asText();
                        if (city == null || city.isEmpty()) {
                            city = addressComponent.path("district").asText();
                        }
                        geoInfo.setCity(city);

                        // adcode：区级编码（如440305），需推导省/市级编码
                        String adcode = addressComponent.path("adcode").asText();
                        if (adcode != null && !adcode.isEmpty()) {
                            // 省级编码：前2位 + "0000"（如440000=广东省）
                            if (adcode.length() >= 2) {
                                geoInfo.setProvinceAdcode(adcode.substring(0, 2) + "0000");
                            }
                            // 市级编码：前4位 + "00"（如440300=深圳市，而非440305=南山区）
                            if (adcode.length() >= 4) {
                                geoInfo.setCityAdcode(adcode.substring(0, 4) + "00");
                            } else {
                                geoInfo.setCityAdcode(adcode);
                            }
                        }

                        return geoInfo;
                    } catch (Exception e) {
                        log.error("解析逆地理编码响应失败: {}", e.getMessage());
                        return null;
                    }
                })
                .onErrorResume(e -> {
                    log.error("调用高德逆地理编码API失败: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    @Override
    public Mono<StatsResult> getStats() {
        return client.list(Footprint.class, fp -> true, null)
                .collectList()
                .map(footprints -> {
                    long totalFootprints = footprints.size();

                    // provinceAdcode -> {name, count, cityNames}
                    Map<String, StatsResult.ProvinceStat> provinceMap = new LinkedHashMap<>();
                    // cityAdcode -> {name, province, count}
                    Map<String, StatsResult.CityStat> cityMap = new LinkedHashMap<>();

                    for (Footprint fp : footprints) {
                        Footprint.FootprintSpec spec = fp.getSpec();
                        if (spec == null) continue;

                        // 省份统计
                        String pAdcode = spec.getProvinceAdcode();
                        String pName = spec.getProvince();
                        if (pAdcode != null && !pAdcode.isEmpty()) {
                            StatsResult.ProvinceStat ps = provinceMap.computeIfAbsent(pAdcode, k ->
                                StatsResult.ProvinceStat.builder()
                                    .adcode(k)
                                    .name(pName != null ? pName : "")
                                    .count(0)
                                    .cities(new ArrayList<>())
                                    .build());
                            ps.setCount(ps.getCount() + 1);
                        }

                        // 城市统计：将cityAdcode归一化为市级编码（前4位+00），兼容旧数据
                        String rawCAdcode = spec.getCityAdcode();
                        String cAdcode = rawCAdcode;
                        if (rawCAdcode != null && rawCAdcode.length() >= 4) {
                            cAdcode = rawCAdcode.substring(0, 4) + "00";
                        }
                        String cName = spec.getCity();
                        if (cAdcode != null && !cAdcode.isEmpty()) {
                            StatsResult.CityStat cs = cityMap.computeIfAbsent(cAdcode, k ->
                                StatsResult.CityStat.builder()
                                    .adcode(k)
                                    .name(cName != null ? cName : "")
                                    .province(pName != null ? pName : "")
                                    .provinceAdcode(pAdcode != null ? pAdcode : "")
                                    .count(0)
                                    .build());
                            cs.setCount(cs.getCount() + 1);
                        }

                        // 将城市名加入对应省份的城市列表
                        if (pAdcode != null && !pAdcode.isEmpty()
                            && cName != null && !cName.isEmpty()
                            && provinceMap.containsKey(pAdcode)) {
                            List<String> cities = provinceMap.get(pAdcode).getCities();
                            if (!cities.contains(cName)) {
                                cities.add(cName);
                            }
                        }
                    }

                                        List<StatsResult.ProvinceStat> sortedProvinces = new ArrayList<>(provinceMap.values());
                    sortedProvinces.sort((a, b) -> Long.compare(b.getCount(), a.getCount()));
                    List<StatsResult.CityStat> sortedCities = new ArrayList<>(cityMap.values());
                    sortedCities.sort((a, b) -> Long.compare(b.getCount(), a.getCount()));

                    return StatsResult.builder()
                            .totalFootprints(totalFootprints)
                            .totalProvinces(provinceMap.size())
                            .totalCities(cityMap.size())
                            .provinces(sortedProvinces)
                            .cities(sortedCities)
                            .build();
                });
    }
}
