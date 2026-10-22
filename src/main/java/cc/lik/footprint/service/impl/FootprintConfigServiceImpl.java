package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.service.FootprintConfigService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Secret;
import run.halo.app.plugin.ReactiveSettingFetcher;

import java.util.Map;

/**
 * 配置组装：六组 setting + 三个 Secret → 一份 BaseConfig。
 *
 * <p>这里只有「读」和「拼」，没有任何业务逻辑。两个细节值得留意：</p>
 * <ul>
 *   <li>globe3d 组同时是 2.9.18 及更早版本所有 3D 相关配置的存放位置，
 *       拆分后的新分组优先、globe3d 兜底，保证迁移未完成时前台行为不变；</li>
 *   <li>天地图属于可选能力，它指向的 Secret 缺失不应该让整份配置失败，
 *       否则用户一旦填错 Secret 名，连足迹页面都打不开。</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FootprintConfigServiceImpl implements FootprintConfigService {

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
}
