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
                fetchSetting("globe3d").defaultIfEmpty(objectMapper.createObjectNode()),
                fetchSetting("tianditu").defaultIfEmpty(objectMapper.createObjectNode()),
                fetchSetting("ticket").defaultIfEmpty(objectMapper.createObjectNode()),
                fetchSetting("cityWall").defaultIfEmpty(objectMapper.createObjectNode()),
                fetchSetting("imageProcess").defaultIfEmpty(objectMapper.createObjectNode())
            )
            .flatMap(tuple -> {
                JsonNode base = tuple.getT1();
                // globe3d 同时也是 2.9.18 及更早版本所有 3D 相关配置的遗留存放位置
                JsonNode legacy = tuple.getT2();
                JsonNode tianditu = tuple.getT3();
                JsonNode ticket = tuple.getT4();
                JsonNode cityWall = tuple.getT5();
                JsonNode image = tuple.getT6();

                return Mono.zip(
                    getSecretValue(base.path("gaoDeKeySecretName").asText()),
                    getSecretValue(base.path("gaoDeWebKeySecretName").asText()),
                    resolveTiandituKey(tianditu, legacy)
                ).map(keys -> BaseConfig.builder()
                    .title(base.path("title").asText("Handsome足迹"))
                    .gaoDeKey(keys.getT1())
                    .gaoDeWebKey(keys.getT2())
                    .describe(base.path("describe")
                        .asText("每一处足迹都充满了故事，那是对人生的思考和无限的风光。"))
                    .hsla(base.path("hsla").asText("109,42%,60%"))
                    .logoName(base.path("logoName").asText())
                    .mapStyle(base.path("mapStyle").asText())
                    .markerStyle(base.path("markerStyle").asText("pin"))
                    .enableHoverZoom(base.path("enableHoverZoom").asBoolean(true))
                    .highlightScheme(base.path("highlightScheme").asText("glow"))
                    .highlightVisitedCities(base.path("highlightVisitedCities").asBoolean(true))
                    .photoWallPageSize(base.path("photoWallPageSize").asInt(6))
                    .photoWallStyle(base.path("photoWallStyle").asText("original"))

                    .globeTitle(legacy.path("globeTitle").asText("旅行记忆"))
                    .globeDesc(legacy.path("globeDesc")
                        .asText("把每一次出发，收藏成地球上的坐标；让走过的城市，成为星空下的故事。"))
                    .globeLabels(legacy.path("globeLabels").asText("all"))

                    .tiandituKey(keys.getT3())
                    .enableTerrainDefault(
                        field(tianditu, legacy, "enableTerrainDefault").asBoolean(false))

                    .ticketGalleryStyle(field(ticket, legacy, "ticketGalleryStyle").asText("fan"))
                    .enableTicketJourneyReplay(
                        field(ticket, legacy, "enableTicketJourneyReplay").asBoolean(false))
                    .enableTicketSeasonLight(
                        field(ticket, legacy, "enableTicketSeasonLight").asBoolean(false))
                    .enableTicketOracle(
                        field(ticket, legacy, "enableTicketOracle").asBoolean(false))
                    .enableTicketLetter(
                        field(ticket, legacy, "enableTicketLetter").asBoolean(false))
                    .enableTicketPassport(
                        field(ticket, legacy, "enableTicketPassport").asBoolean(false))

                    .mobileCityWallColumns(
                        field(cityWall, legacy, "mobileCityWallColumns").asInt(2))
                    .enableTimeCapsule(
                        field(cityWall, legacy, "enableTimeCapsule").asBoolean(true))
                    .enableInsight(field(cityWall, legacy, "enableInsight").asBoolean(true))
                    .cityCardHoverCarousel(
                        field(cityWall, legacy, "cityCardHoverCarousel").asBoolean(true))
                    .enablePostcard(field(cityWall, legacy, "enablePostcard").asBoolean(true))

                    .markerImageFrom(image.path("markerImageFrom").asText(""))
                    .markerImageTo(image.path("markerImageTo").asText(""))
                    .markerImageSuffix(image.path("markerImageSuffix").asText(""))
                    .timelineImageFrom(image.path("timelineImageFrom").asText(""))
                    .timelineImageTo(image.path("timelineImageTo").asText(""))
                    .timelineImageSuffix(image.path("timelineImageSuffix").asText(""))
                    .cityWallImageFrom(image.path("cityWallImageFrom").asText(""))
                    .cityWallImageTo(image.path("cityWallImageTo").asText(""))
                    .cityWallImageSuffix(image.path("cityWallImageSuffix").asText(""))
                    .build());
            });
    }

    /**
     * <p>按「新分组优先、globe3d 兜底」的顺序取字段。</p>
     *
     * <p>2.9.18 及更早版本把 3D 地球、天地图、票根页、城市卡片墙的配置全部存在 globe3d
     * 一个分组里。拆分后配置迁移在插件启动时异步执行，这里的兜底保证迁移尚未完成、
     * 或因任何原因失败时，前台读到的仍是用户原先的配置而不是一堆默认值。</p>
     */
    private static JsonNode field(JsonNode current, JsonNode legacy, String name) {
        JsonNode value = current.path(name);
        return value.isMissingNode() || value.isNull() ? legacy.path(name) : value;
    }

    /**
     * 天地图 Key 现已改存 Halo Secret。迁移完成前仍读 globe3d 里的明文字段，
     * 避免升级瞬间三维地形与天地图底图失效。
     */
    private Mono<String> resolveTiandituKey(JsonNode tianditu, JsonNode legacy) {
        String secretName = tianditu.path("tiandituKeySecretName").asText("");
        if (secretName.isBlank()) {
            return Mono.just(legacy.path("tiandituKey").asText(""));
        }
        // 天地图属于可选能力，Secret 缺失不应让整份配置加载失败
        return getSecretValue(secretName)
            .onErrorResume(e -> {
                log.warn("读取天地图 Key Secret [{}] 失败，将按未配置处理", secretName, e);
                return Mono.just("");
            });
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
