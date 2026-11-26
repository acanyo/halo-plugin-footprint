package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.dto.FootprintImportRequest;
import cc.lik.footprint.dto.FootprintImportRow;
import cc.lik.footprint.dto.LocatedGeoInfo;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintConfigService;
import cc.lik.footprint.service.GaodeGeocodingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;

import java.time.Duration;
import java.util.List;
import java.util.function.Predicate;
import java.util.concurrent.atomic.AtomicReference;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SuppressWarnings("unchecked")
class FootprintImportServiceImplTest {

    private ReactiveExtensionClient client;
    private FootprintConfigService configService;
    private GaodeGeocodingService geocodingService;
    private FootprintImportServiceImpl service;

    @BeforeEach
    void setUp() {
        client = mock(ReactiveExtensionClient.class);
        configService = mock(FootprintConfigService.class);
        geocodingService = mock(GaodeGeocodingService.class);
        service = new FootprintImportServiceImpl(client, configService, geocodingService);

        when(configService.getConfigByGroupName())
            .thenReturn(Mono.just(BaseConfig.builder().gaoDeWebKey("test-key").build()));
        doReturn(Flux.empty())
            .when(client)
            .list(eq(Footprint.class), any(Predicate.class), isNull());
    }

    @Test
    @DisplayName("dryRun 只校验并返回已解析数据，不写库")
    void dryRunDoesNotCreate() {
        FootprintImportRequest request = request(readyRow());

        var result = service.importFootprints(request, true).block(Duration.ofSeconds(2));
        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(result.isDryRun()).isTrue();
        org.assertj.core.api.Assertions.assertThat(result.getReady()).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(result.getSuccess()).isZero();
        org.assertj.core.api.Assertions.assertThat(result.getItems().getFirst().getStatus())
            .isEqualTo("valid");

        verify(client, never()).create(any(Footprint.class));
    }

    @Test
    @DisplayName("正式导入创建足迹，未选择类型时保持为空")
    void commitCreatesFootprint() {
        when(client.create(any(Footprint.class)))
            .thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));

        FootprintImportRequest request = request(readyRow());

        var result = service.importFootprints(request, false).block(Duration.ofSeconds(2));
        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(result.getSuccess()).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(result.getFailed()).isZero();
        org.assertj.core.api.Assertions.assertThat(result.getItems().getFirst().getStatus())
            .isEqualTo("success");

        verify(client).create(any(Footprint.class));
        verify(geocodingService, never()).locate(any(), any());
    }

    @Test
    @DisplayName("批量导入会把窗口中选中的类型写入全部足迹")
    void commitAppliesSelectedFootprintType() {
        AtomicReference<Footprint> created = new AtomicReference<>();
        when(client.create(any(Footprint.class))).thenAnswer(invocation -> {
            Footprint footprint = invocation.getArgument(0);
            created.set(footprint);
            return Mono.just(footprint);
        });
        FootprintImportRow row = readyRow().toBuilder()
            .footprintType(null)
            .build();
        FootprintImportRequest request = request(row);
        request.setFootprintType("旅游");

        var result = service.importFootprints(request, false)
            .block(Duration.ofSeconds(2));

        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(result.getSuccess()).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(created.get().getSpec().getFootprintType())
            .isEqualTo("旅游");
    }

    @Test
    @DisplayName("逐行手动选择的类型优先于批量默认类型")
    void rowTypeOverridesBatchDefault() {
        FootprintImportRow row = readyRow().toBuilder()
            .footprintType("美食")
            .build();
        AtomicReference<Footprint> created = new AtomicReference<>();
        when(client.create(any(Footprint.class))).thenAnswer(invocation -> {
            Footprint footprint = invocation.getArgument(0);
            created.set(footprint);
            return Mono.just(footprint);
        });
        FootprintImportRequest request = request(row);
        request.setFootprintType("旅游");

        var result = service.importFootprints(request, false)
            .block(Duration.ofSeconds(2));

        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(created.get().getSpec().getFootprintType())
            .isEqualTo("美食");
    }

    @Test
    @DisplayName("批量导入未提供类型时该行失败")
    void missingTypeFailsRow() {
        FootprintImportRow row = readyRow().toBuilder()
            .footprintType(null)
            .build();

        var result = service.importFootprints(request(row), true)
            .block(Duration.ofSeconds(2));

        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(result.getFailed()).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(result.getItems().getFirst().getMessage())
            .isEqualTo("请选择足迹类型");
    }

    @Test
    @DisplayName("地址导入只调用一次正向解析，不额外调用逆地理编码")
    void addressOnlyUsesSingleGeocodeCall() {
        FootprintImportRow row = readyRow().toBuilder()
            .longitude(null)
            .latitude(null)
            .province(null)
            .city(null)
            .provinceAdcode(null)
            .cityAdcode(null)
            .build();
        LocatedGeoInfo location = new LocatedGeoInfo();
        location.setLongitude(120.1);
        location.setLatitude(30.2);
        location.setProvince("浙江省");
        location.setCity("杭州市");
        location.setProvinceAdcode("330000");
        location.setCityAdcode("330100");
        when(geocodingService.locateWithGeoInfo(row.getAddress(), "test-key"))
            .thenReturn(Mono.just(location));

        var result = service.importFootprints(request(row), true)
            .block(Duration.ofSeconds(2));

        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(result.getReady()).isEqualTo(1);
        verify(geocodingService).locateWithGeoInfo(row.getAddress(), "test-key");
        verify(geocodingService, never()).reverseGeocode(any(), any(), any());
    }

    @Test
    @DisplayName("高德限流后暂停本批剩余地址，不再继续请求")
    void pausesRemainingRowsAfterRateLimit() {
        FootprintImportRow first = readyRow().toBuilder()
            .rowNumber(2)
            .name("西安")
            .address("陕西省西安市雁塔区雁塔南路")
            .longitude(null)
            .latitude(null)
            .province(null)
            .city(null)
            .provinceAdcode(null)
            .cityAdcode(null)
            .build();
        FootprintImportRow second = first.toBuilder()
            .rowNumber(3)
            .name("厦门")
            .address("福建省厦门市思明区鼓浪屿街道")
            .build();
        when(geocodingService.locateWithGeoInfo(any(), any())).thenReturn(Mono.error(
            GaodeApiException.from(
                "CUQPS_HAS_EXCEEDED_THE_LIMIT 10021",
                "高德请求过于频繁"
            )
        ));

        FootprintImportRequest request = new FootprintImportRequest();
        request.setRows(List.of(first, second));
        var result = service.importFootprints(request, true)
            .block(Duration.ofSeconds(3));

        org.assertj.core.api.Assertions.assertThat(result).isNotNull();
        org.assertj.core.api.Assertions.assertThat(result.getFailed()).isEqualTo(2);
        org.assertj.core.api.Assertions.assertThat(result.getItems())
            .extracting(FootprintImportRow::getMessage)
            .allMatch(message -> message.contains("高德请求过于频繁"));
        verify(geocodingService, times(1)).locateWithGeoInfo(any(), any());
    }

    @Test
    @DisplayName("流式预览按行推送并发送完成事件")
    void streamsPreviewRows() {
        FootprintImportRow second = readyRow().toBuilder()
            .rowNumber(3)
            .name("故宫")
            .address("北京市东城区景山前街4号")
            .longitude(116.397)
            .latitude(39.918)
            .province("北京市")
            .city("北京市")
            .provinceAdcode("110000")
            .cityAdcode("110100")
            .build();
        FootprintImportRequest request = new FootprintImportRequest();
        request.setRows(List.of(readyRow(), second));

        var events = service.streamPreview(request)
            .collectList()
            .block(Duration.ofSeconds(3));

        org.assertj.core.api.Assertions.assertThat(events).isNotNull();
        org.assertj.core.api.Assertions.assertThat(events)
            .extracting(event -> event.getType())
            .containsExactly("start", "row", "row", "complete");
        org.assertj.core.api.Assertions.assertThat(events.get(0).getTotal()).isEqualTo(2);
        org.assertj.core.api.Assertions.assertThat(events.get(3).getTotal()).isEqualTo(2);
    }

    private FootprintImportRow readyRow() {
        return FootprintImportRow.builder()
            .rowNumber(2)
            .name("西湖")
            .address("浙江省杭州市西湖区灵隐寺")
            .description("春天")
            .visitTime("2024-05-01T00:00:00Z")
            .zoomLevel("14")
            .footprintType("旅游")
            .longitude(120.1)
            .latitude(30.2)
            .province("浙江省")
            .city("杭州市")
            .provinceAdcode("330000")
            .cityAdcode("330100")
            .build();
    }

    private FootprintImportRequest request(FootprintImportRow row) {
        FootprintImportRequest request = new FootprintImportRequest();
        request.setRows(List.of(row));
        return request;
    }
}
