package cc.lik.footprint.migration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ConfigMap;
import run.halo.app.extension.GroupVersionKind;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Secret;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <p>把 2.9.18 及更早版本堆在 {@code globe3d} 一个分组里的配置，拆分到
 * {@code tianditu} / {@code ticket} / {@code cityWall} 三个新分组，并把明文存放的
 * 天地图 Key 迁移到 Halo Secret。</p>
 *
 * <p>整个过程是幂等的：迁移完成后 {@code globe3d} 中不再留有可迁移字段，重复执行
 * 直接短路返回。迁移失败不会影响插件启动，也不会影响前台——
 * {@code FootprintServiceImpl} 读配置时对这些字段保留了 globe3d 兜底。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SettingsMigration {

    /** 与 plugin.yaml 的 spec.configMapName 保持一致 */
    private static final String CONFIG_MAP_NAME = "plugin-footprint-configmap";

    /** 拆分前所有 3D 相关配置的存放分组 */
    private static final String LEGACY_GROUP = "globe3d";

    /** 迁移明文天地图 Key 时创建的 Secret 名称 */
    private static final String TIANDITU_SECRET_NAME = "footprint-tianditu-key";

    private static final String LEGACY_TIANDITU_KEY = "tiandituKey";
    private static final String TIANDITU_SECRET_FIELD = "tiandituKeySecretName";

    /**
     * 拆分后新分组仍保留在 globe3d 的字段：globeTitle / globeDesc / globeLabels
     * 不在此列，它们留在原地，不需要搬迁。
     */
    private static final Map<String, List<String>> FIELD_MOVES = Map.of(
        "tianditu", List.of("enableTerrainDefault"),
        "ticket", List.of(
            "ticketGalleryStyle",
            "enableTicketJourneyReplay",
            "enableTicketSeasonLight",
            "enableTicketOracle",
            "enableTicketLetter",
            "enableTicketPassport"
        ),
        "cityWall", List.of(
            "mobileCityWallColumns",
            "enableTimeCapsule",
            "enableInsight",
            "cityCardHoverCarousel",
            "enablePostcard"
        )
    );

    /**
     * 后端曾读取但 settings.yaml 中从未定义、前端也从未使用的遗留字段，顺带清掉。
     */
    private static final List<String> OBSOLETE_FIELDS = List.of("ticketGalleryInfoStyle");

    private final ReactiveExtensionClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 执行迁移。任何异常都被吞掉并记日志——调用方位于插件启动路径上，
     * 迁移失败必须是「不影响使用」而不是「插件起不来」。
     */
    public Mono<Void> migrate() {
        return client.fetch(ConfigMap.class, CONFIG_MAP_NAME)
            .flatMap(this::migrateConfigMap)
            .onErrorResume(e -> {
                log.error("足迹插件配置迁移失败，将继续使用 globe3d 中的原配置", e);
                return Mono.empty();
            })
            .then();
    }

    private Mono<Void> migrateConfigMap(ConfigMap configMap) {
        Map<String, String> data = configMap.getData();
        if (data == null || !data.containsKey(LEGACY_GROUP)) {
            return Mono.empty();
        }

        ObjectNode legacy = readGroup(data, LEGACY_GROUP);
        if (!needsMigration(legacy)) {
            return Mono.empty();
        }

        Map<String, ObjectNode> groups = new LinkedHashMap<>();
        FIELD_MOVES.forEach((group, fields) -> {
            ObjectNode target = readGroup(data, group);
            for (String fieldName : fields) {
                // 用户在新分组里已经保存过的值优先，不被旧值覆盖
                if (legacy.has(fieldName) && !target.has(fieldName)) {
                    target.set(fieldName, legacy.get(fieldName));
                }
                legacy.remove(fieldName);
            }
            groups.put(group, target);
        });

        OBSOLETE_FIELDS.forEach(legacy::remove);

        String plainKey = legacy.path(LEGACY_TIANDITU_KEY).asText("");
        ObjectNode tianditu = groups.get("tianditu");
        boolean needSecret = !plainKey.isBlank()
            && tianditu.path(TIANDITU_SECRET_FIELD).asText("").isBlank();

        Mono<Void> ensureSecret = needSecret
            ? ensureTiandituSecret(plainKey)
                .doOnNext(secretName -> {
                    tianditu.put(TIANDITU_SECRET_FIELD, secretName);
                    // 仅在 Secret 确实就绪后才删除明文，否则宁可留着让兜底逻辑继续生效
                    legacy.remove(LEGACY_TIANDITU_KEY);
                })
                .onErrorResume(e -> {
                    log.error("迁移天地图 Key 到 Secret 失败，保留 globe3d 中的明文配置", e);
                    return Mono.empty();
                })
                .then()
            : Mono.empty();

        return ensureSecret.then(Mono.defer(() -> {
            groups.forEach((group, node) -> writeGroup(data, group, node));
            writeGroup(data, LEGACY_GROUP, legacy);
            configMap.setData(data);
            return client.update(configMap)
                .doOnSuccess(unused -> log.info(
                    "足迹插件配置迁移完成：globe3d 已拆分为 globe3d / tianditu / ticket / cityWall"))
                .then();
        }));
    }

    /**
     * 判断 globe3d 里是否还残留着需要搬走的字段。迁移完成后这里返回 false，
     * 后续每次启动都直接短路。
     */
    private boolean needsMigration(ObjectNode legacy) {
        boolean hasMovable = FIELD_MOVES.values().stream()
            .flatMap(List::stream)
            .anyMatch(legacy::has);
        boolean hasObsolete = OBSOLETE_FIELDS.stream().anyMatch(legacy::has);
        boolean hasPlainKey = !legacy.path(LEGACY_TIANDITU_KEY).asText("").isBlank();
        return hasMovable || hasObsolete || hasPlainKey;
    }

    /**
     * 创建（或复用）承载天地图 Key 的 Secret，返回其名称。
     */
    private Mono<String> ensureTiandituSecret(String plainKey) {
        return client.fetch(Secret.class, TIANDITU_SECRET_NAME)
            .map(existing -> {
                log.info("Secret [{}] 已存在，直接复用", TIANDITU_SECRET_NAME);
                return existing.getMetadata().getName();
            })
            .switchIfEmpty(Mono.defer(() -> client.create(buildTiandituSecret(plainKey))
                .map(created -> {
                    log.info("已将明文天地图 Key 迁移到 Secret [{}]", TIANDITU_SECRET_NAME);
                    return created.getMetadata().getName();
                })));
    }

    private Secret buildTiandituSecret(String plainKey) {
        GroupVersionKind gvk = GroupVersionKind.fromExtension(Secret.class);
        Metadata metadata = new Metadata();
        metadata.setName(TIANDITU_SECRET_NAME);

        Secret secret = new Secret();
        secret.setApiVersion(gvk.groupVersion().toString());
        secret.setKind(gvk.kind());
        secret.setMetadata(metadata);
        secret.setType(Secret.SECRET_TYPE_OPAQUE);
        // 字段名必须是 key：settings.yaml 的 requiredKeys 与服务端读取逻辑都按此约定
        secret.setStringData(Map.of("key", plainKey));
        return secret;
    }

    private ObjectNode readGroup(Map<String, String> data, String group) {
        String raw = data.get(group);
        if (raw == null || raw.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            return objectMapper.readValue(raw, ObjectNode.class);
        } catch (Exception e) {
            log.warn("配置分组 [{}] 解析失败，按空分组处理", group, e);
            return objectMapper.createObjectNode();
        }
    }

    private void writeGroup(Map<String, String> data, String group, ObjectNode node) {
        try {
            data.put(group, objectMapper.writeValueAsString(node));
        } catch (Exception e) {
            throw new IllegalStateException("配置分组 [" + group + "] 序列化失败", e);
        }
    }
}
