package cc.lik.footprint.migration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ConfigMap;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Secret;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 迁移会原地改写用户已保存的配置，出错代价高且难以察觉，因此对拆分结果、
 * 幂等性、冲突处理和失败回退逐项断言。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SettingsMigrationTest {

    private static final String CONFIG_MAP_NAME = "plugin-footprint-configmap";

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private ReactiveExtensionClient client;

    @InjectMocks
    private SettingsMigration migration;

    private ConfigMap configMap;

    @BeforeEach
    void setUp() {
        configMap = new ConfigMap();
        Metadata metadata = new Metadata();
        metadata.setName(CONFIG_MAP_NAME);
        configMap.setMetadata(metadata);
        configMap.setData(new HashMap<>());

        when(client.fetch(ConfigMap.class, CONFIG_MAP_NAME)).thenReturn(Mono.just(configMap));
        when(client.update(any(ConfigMap.class)))
            .thenAnswer(inv -> Mono.just(inv.getArgument(0)));
    }

    private void givenLegacyGlobe3d(String json) {
        configMap.getData().put("globe3d", json);
    }

    private ObjectNode group(String name) throws Exception {
        String raw = configMap.getData().get(name);
        return raw == null ? objectMapper.createObjectNode()
            : objectMapper.readValue(raw, ObjectNode.class);
    }

    @Test
    @DisplayName("globe3d 中的字段按目标分组拆分，3D 地球自身的三个字段留在原地")
    void splitsLegacyGroupIntoNewGroups() throws Exception {
        givenLegacyGlobe3d("""
            {
              "globeTitle": "我的旅行",
              "globeDesc": "描述",
              "globeLabels": "city",
              "enableTerrainDefault": true,
              "ticketGalleryStyle": "strip",
              "enableTicketOracle": true,
              "mobileCityWallColumns": 3,
              "enableInsight": false
            }
            """);

        migration.migrate().block();

        assertThat(group("tianditu").path("enableTerrainDefault").asBoolean()).isTrue();

        ObjectNode ticket = group("ticket");
        assertThat(ticket.path("ticketGalleryStyle").asText()).isEqualTo("strip");
        assertThat(ticket.path("enableTicketOracle").asBoolean()).isTrue();

        ObjectNode cityWall = group("cityWall");
        assertThat(cityWall.path("mobileCityWallColumns").asInt()).isEqualTo(3);
        assertThat(cityWall.path("enableInsight").asBoolean()).isFalse();

        // globe3d 只保留属于自己的三个字段，搬走的字段必须清除，否则兜底逻辑会一直读到旧值
        ObjectNode legacy = group("globe3d");
        assertThat(legacy.fieldNames()).toIterable()
            .containsExactlyInAnyOrder("globeTitle", "globeDesc", "globeLabels");
    }

    @Test
    @DisplayName("已迁移过的配置不会再次写入")
    void isIdempotent() {
        givenLegacyGlobe3d("""
            {"globeTitle": "我的旅行", "globeDesc": "描述", "globeLabels": "city"}
            """);

        migration.migrate().block();

        verify(client, never()).update(any(ConfigMap.class));
    }

    @Test
    @DisplayName("新分组中已存在的值优先，不被 globe3d 的旧值覆盖")
    void keepsExistingValueInTargetGroup() throws Exception {
        givenLegacyGlobe3d("""
            {"ticketGalleryStyle": "fan", "enableTicketLetter": true}
            """);
        configMap.getData().put("ticket", """
            {"ticketGalleryStyle": "strip"}
            """);

        migration.migrate().block();

        ObjectNode ticket = group("ticket");
        assertThat(ticket.path("ticketGalleryStyle").asText()).isEqualTo("strip");
        // 新分组里没有的字段仍要从旧分组补进来
        assertThat(ticket.path("enableTicketLetter").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("明文天地图 Key 迁移为 Secret，并从 globe3d 中清除")
    void migratesPlainTiandituKeyToSecret() throws Exception {
        givenLegacyGlobe3d("""
            {"tiandituKey": "abc123", "enableTerrainDefault": true}
            """);
        when(client.fetch(eq(Secret.class), anyString())).thenReturn(Mono.empty());
        when(client.create(any(Secret.class)))
            .thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        migration.migrate().block();

        ArgumentCaptor<Secret> captor = ArgumentCaptor.forClass(Secret.class);
        verify(client).create(captor.capture());
        Secret created = captor.getValue();
        assertThat(created.getMetadata().getName()).isEqualTo("footprint-tianditu-key");
        assertThat(created.getStringData()).containsEntry("key", "abc123");
        assertThat(created.getApiVersion()).isNotBlank();
        assertThat(created.getKind()).isEqualTo("Secret");

        assertThat(group("tianditu").path("tiandituKeySecretName").asText())
            .isEqualTo("footprint-tianditu-key");
        assertThat(group("globe3d").has("tiandituKey")).isFalse();
    }

    @Test
    @DisplayName("Secret 创建失败时保留明文，避免天地图直接失效")
    void keepsPlainKeyWhenSecretCreationFails() throws Exception {
        givenLegacyGlobe3d("""
            {"tiandituKey": "abc123", "enableTicketOracle": true}
            """);
        when(client.fetch(eq(Secret.class), anyString())).thenReturn(Mono.empty());
        when(client.create(any(Secret.class)))
            .thenReturn(Mono.error(new RuntimeException("boom")));

        migration.migrate().block();

        // 明文必须留着，FootprintServiceImpl 的 globe3d 兜底才能继续读到
        assertThat(group("globe3d").path("tiandituKey").asText()).isEqualTo("abc123");
        assertThat(group("tianditu").has("tiandituKeySecretName")).isFalse();
        // 其余字段的拆分不受 Secret 失败影响
        assertThat(group("ticket").path("enableTicketOracle").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("已有同名 Secret 时直接复用，不重复创建")
    void reusesExistingSecret() throws Exception {
        givenLegacyGlobe3d("""
            {"tiandituKey": "abc123"}
            """);
        Secret existing = new Secret();
        Metadata metadata = new Metadata();
        metadata.setName("footprint-tianditu-key");
        existing.setMetadata(metadata);
        when(client.fetch(eq(Secret.class), anyString())).thenReturn(Mono.just(existing));

        migration.migrate().block();

        verify(client, never()).create(any(Secret.class));
        assertThat(group("tianditu").path("tiandituKeySecretName").asText())
            .isEqualTo("footprint-tianditu-key");
        assertThat(group("globe3d").has("tiandituKey")).isFalse();
    }

    @Test
    @DisplayName("ConfigMap 不存在时安全退出")
    void doesNothingWhenConfigMapMissing() {
        when(client.fetch(ConfigMap.class, CONFIG_MAP_NAME)).thenReturn(Mono.empty());

        migration.migrate().block();

        verify(client, never()).update(any(ConfigMap.class));
    }

    @Test
    @DisplayName("globe3d 内容损坏时不抛出，也不写坏其他分组")
    void toleratesCorruptedLegacyGroup() {
        givenLegacyGlobe3d("{ this is not json");

        migration.migrate().block();

        verify(client, never()).update(any(ConfigMap.class));
    }

    @Test
    @DisplayName("清除后端已不再使用的遗留字段 ticketGalleryInfoStyle")
    void removesObsoleteField() throws Exception {
        givenLegacyGlobe3d("""
            {"globeTitle": "我的旅行", "ticketGalleryInfoStyle": "card"}
            """);

        migration.migrate().block();

        Map<String, String> data = configMap.getData();
        assertThat(data).containsKey("globe3d");
        assertThat(group("globe3d").has("ticketGalleryInfoStyle")).isFalse();
        assertThat(group("globe3d").path("globeTitle").asText()).isEqualTo("我的旅行");
    }
}
