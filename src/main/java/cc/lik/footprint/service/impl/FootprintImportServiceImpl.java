package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.FootprintImportRequest;
import cc.lik.footprint.dto.FootprintImportResult;
import cc.lik.footprint.dto.FootprintImportRow;
import cc.lik.footprint.dto.FootprintImportStreamEvent;
import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.LocatedGeoInfo;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintConfigService;
import cc.lik.footprint.service.FootprintImportService;
import cc.lik.footprint.service.GaodeGeocodingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.Exceptions;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;

import java.time.Instant;
import java.time.Duration;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 足迹批量导入。
 *
 * <p>地址解析和写库都不阻塞 WebFlux 线程。地址解析串行执行并主动节流，
 * 写库同样串行，避免大批量导入瞬时冲击高德和 Halo Extension Store。</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FootprintImportServiceImpl implements FootprintImportService {

    private static final int MAX_ROWS = 500;
    private static final Duration GEOCODE_INTERVAL = Duration.ofMillis(300);
    private static final int NAME_MAX_LENGTH = 100;
    private static final int DESCRIPTION_MAX_LENGTH = 500;
    private static final int ADDRESS_MAX_LENGTH = 200;
    private static final String DEFAULT_ZOOM_LEVEL = "14";
    // TEMP TEST HOOK: 用于批量导入失败场景测试，测试结束后移除。
    private static final String TEST_FAILURE_MARKER = "[TEST_FAIL]";

    private final ReactiveExtensionClient client;
    private final FootprintConfigService configService;
    private final GaodeGeocodingService geocodingService;

    @Override
    public Mono<FootprintImportResult> importFootprints(
        FootprintImportRequest request,
        boolean dryRun
    ) {
        return prepareImport(request)
            .flatMap(prepared -> resolveLocations(
                    prepared.rows(),
                    prepared.webKey()
                )
                .flatMap(items -> dryRun
                    ? Mono.just(toResult(items, true))
                    : createFootprints(items)));
    }

    @Override
    public Flux<FootprintImportStreamEvent> streamPreview(
        FootprintImportRequest request
    ) {
        return prepareImport(request)
            .flatMapMany(prepared -> Flux.concat(
                Mono.just(FootprintImportStreamEvent.builder()
                    .type("start")
                    .total(prepared.rows().size())
                    .build()),
                resolveLocationsFlux(prepared.rows(), prepared.webKey())
                    .map(item -> FootprintImportStreamEvent.builder()
                        .type("row")
                        .item(item)
                        .build()),
                Mono.just(FootprintImportStreamEvent.builder()
                    .type("complete")
                    .total(prepared.rows().size())
                    .build())
            ))
            .onErrorResume(error -> Flux.just(
                FootprintImportStreamEvent.builder()
                    .type("error")
                    .message(friendlyError(error))
                    .build()
            ));
    }

    private Mono<PreparedImport> prepareImport(FootprintImportRequest request) {
        List<FootprintImportRow> rows = request == null ? null : request.getRows();
        if (rows == null || rows.isEmpty()) {
            return Mono.error(new IllegalArgumentException("请提供要导入的足迹数据"));
        }
        if (rows.size() > MAX_ROWS) {
            return Mono.error(new IllegalArgumentException(
                "单次最多导入 " + MAX_ROWS + " 条足迹，请分批导入"
            ));
        }
        String footprintType = request == null ? null : trimToNull(request.getFootprintType());
        if (footprintType != null && footprintType.length() > 100) {
            return Mono.error(new IllegalArgumentException("足迹类型不能超过 100 个字符"));
        }

        return configService.getConfigByGroupName()
            .switchIfEmpty(Mono.error(new IllegalStateException("未找到足迹配置")))
            .flatMap(config -> {
                String webKey = config.getGaoDeWebKey();
                if (webKey == null || webKey.isBlank()) {
                    return Mono.error(new IllegalArgumentException(
                        "未配置高德 Web 服务 Key，无法根据地址解析经纬度"
                    ));
                }
                return client.list(Footprint.class, footprint -> true, null)
                    .collectList()
                    .flatMap(existing -> prepareRows(rows, existing, footprintType))
                    .map(items -> new PreparedImport(items, webKey));
            });
    }

    private record PreparedImport(List<FootprintImportRow> rows, String webKey) {
    }

    private Mono<List<FootprintImportRow>> prepareRows(
        List<FootprintImportRow> input,
        List<Footprint> existing,
        String defaultFootprintType
    ) {
        Set<String> existingKeys = new HashSet<>();
        existing.forEach(footprint -> {
            if (footprint.getSpec() == null || footprint.getSpec().getCreateTime() == null) {
                return;
            }
            existingKeys.add(FootprintImportSupport.duplicateKey(
                footprint.getSpec().getName(),
                footprint.getSpec().getAddress(),
                footprint.getSpec().getCreateTime()
            ));
        });

        Set<String> importedKeys = new HashSet<>();
        List<FootprintImportRow> prepared = new ArrayList<>(input.size());
        for (int index = 0; index < input.size(); index++) {
            FootprintImportRow item = copyForProcessing(input.get(index));
            if (item.getRowNumber() == null) {
                item.setRowNumber(index + 1);
            }
            if (item.getFootprintType() == null || item.getFootprintType().isBlank()) {
                item.setFootprintType(defaultFootprintType);
            }
            validateBaseFields(item);
            if ("valid".equals(item.getStatus())) {
                String key = FootprintImportSupport.duplicateKey(
                    item.getName(),
                    item.getAddress(),
                    FootprintImportSupport.parseVisitTime(
                        item.getVisitTime(),
                        ZoneId.systemDefault()
                    )
                );
                if (existingKeys.contains(key)) {
                    mark(item, "duplicate", "数据库中已存在相同名称、地址和访问时间");
                } else if (!importedKeys.add(key)) {
                    mark(item, "duplicate", "导入数据中存在相同名称、地址和访问时间");
                }
            }
            prepared.add(item);
        }
        return Mono.just(prepared);
    }

    private void validateBaseFields(FootprintImportRow item) {
        item.setName(trimToNull(item.getName()));
        item.setAddress(trimToNull(item.getAddress()));
        item.setDescription(trimToNull(item.getDescription()));
        item.setVisitTime(trimToNull(item.getVisitTime()));
        item.setZoomLevel(DEFAULT_ZOOM_LEVEL);
        item.setFootprintType(trimToNull(item.getFootprintType()));

        if (item.getName() == null) {
            mark(item, "invalid", "地点名称不能为空");
        } else if (item.getName().length() > NAME_MAX_LENGTH) {
            mark(item, "invalid", "地点名称不能超过 " + NAME_MAX_LENGTH + " 个字符");
        } else if (item.getFootprintType() == null) {
            mark(item, "invalid", "请选择足迹类型");
        } else if (item.getFootprintType().length() > 100) {
            mark(item, "invalid", "足迹类型不能超过 100 个字符");
        } else if (item.getDescription() == null) {
            mark(item, "invalid", "描述不能为空");
        } else if (item.getDescription().length() > DESCRIPTION_MAX_LENGTH) {
            mark(item, "invalid", "描述不能超过 " + DESCRIPTION_MAX_LENGTH + " 个字符");
        } else if (item.getDescription().contains(TEST_FAILURE_MARKER)) {
            mark(item, "invalid", "测试失败：已触发导入失败模拟");
        } else if (item.getAddress() == null) {
            mark(item, "invalid", "地址不能为空");
        } else if (item.getAddress().length() > ADDRESS_MAX_LENGTH) {
            mark(item, "invalid", "地址不能超过 " + ADDRESS_MAX_LENGTH + " 个字符");
        } else {
            try {
                Instant instant = FootprintImportSupport.parseVisitTime(
                    item.getVisitTime(),
                    ZoneId.systemDefault()
                );
                item.setVisitTime(instant.toString());
            } catch (IllegalArgumentException e) {
                mark(item, "invalid", e.getMessage());
                return;
            }

            if (item.getLongitude() != null
                && (item.getLongitude() < -180 || item.getLongitude() > 180)) {
                mark(item, "invalid", "经度必须在 -180 到 180 之间");
                return;
            }
            if (item.getLatitude() != null
                && (item.getLatitude() < -90 || item.getLatitude() > 90)) {
                mark(item, "invalid", "纬度必须在 -90 到 90 之间");
                return;
            }
            item.setStatus("valid");
            item.setMessage(null);
        }
    }

    private Mono<List<FootprintImportRow>> resolveLocations(
        List<FootprintImportRow> items,
        String webKey
    ) {
        return resolveLocationsFlux(items, webKey).collectList();
    }

    private Flux<FootprintImportRow> resolveLocationsFlux(
        List<FootprintImportRow> items,
        String webKey
    ) {
        AtomicReference<String> pauseMessage = new AtomicReference<>();
        return Flux.fromIterable(items)
            .concatMap(item -> {
                if (!"valid".equals(item.getStatus())) {
                    return Mono.just(item);
                }
                if (pauseMessage.get() != null) {
                    mark(item, "invalid", pauseMessage.get());
                    return Mono.just(item);
                }
                return resolveLocation(item, webKey)
                    .onErrorResume(error -> {
                        Throwable cause = Exceptions.unwrap(error);
                        String message = resolveFailureMessage(cause);
                        if (shouldPauseBatch(cause)) {
                            pauseMessage.compareAndSet(null, message);
                        }
                        log.warn(
                            "批量导入第 {} 行地址解析失败: {}",
                            item.getRowNumber(),
                            cause.getMessage()
                        );
                        mark(item, "invalid", message);
                        return Mono.just(item);
                    });
            });
    }

    private Mono<FootprintImportRow> resolveLocation(
        FootprintImportRow item,
        String webKey
    ) {
        if (item.getLongitude() != null && item.getLatitude() != null) {
            if (hasRegion(item)) {
                return Mono.just(item);
            }
            return geocodingService.reverseGeocode(
                    item.getLongitude(),
                    item.getLatitude(),
                    webKey
                )
                .delaySubscription(GEOCODE_INTERVAL)
                .switchIfEmpty(Mono.error(new IllegalStateException("高德未返回有效地址信息")))
                .map(geoInfo -> {
                    applyRegion(item, geoInfo);
                    return item;
                });
        }

        return geocodingService.locateWithGeoInfo(item.getAddress(), webKey)
            .delaySubscription(GEOCODE_INTERVAL)
            .switchIfEmpty(Mono.error(new IllegalStateException("高德未返回有效地址信息")))
            .map(location -> {
                item.setLongitude(location.getLongitude());
                item.setLatitude(location.getLatitude());
                item.setProvince(trimToNull(location.getProvince()));
                item.setCity(trimToNull(location.getCity()));
                item.setProvinceAdcode(trimToNull(location.getProvinceAdcode()));
                item.setCityAdcode(trimToNull(location.getCityAdcode()));
                return item;
            });
    }

    private boolean hasRegion(FootprintImportRow item) {
        return item.getProvince() != null && !item.getProvince().isBlank()
            && item.getCity() != null && !item.getCity().isBlank();
    }

    private void applyRegion(FootprintImportRow item, GeoInfo geoInfo) {
        item.setProvince(trimToNull(geoInfo.getProvince()));
        item.setCity(trimToNull(geoInfo.getCity()));
        item.setProvinceAdcode(trimToNull(geoInfo.getProvinceAdcode()));
        item.setCityAdcode(trimToNull(geoInfo.getCityAdcode()));
    }

    private boolean shouldPauseBatch(Throwable error) {
        return error instanceof GaodeApiException apiException
            && apiException.isGlobalFailure();
    }

    private String resolveFailureMessage(Throwable error) {
        if (error instanceof GaodeApiException apiException) {
            return switch (apiException.getKind()) {
                case RATE_LIMIT ->
                    "高德请求过于频繁，本批剩余地址已暂停；请稍后重新解析失败行";
                case DAILY_LIMIT ->
                    "高德今日调用额度已用完，本批剩余地址已暂停；请稍后或更换 Key 后重试";
                case INVALID_KEY ->
                    "高德 Web 服务 Key 无效，本批剩余地址已暂停；请检查插件配置";
                case OTHER -> "地址解析失败: " + friendlyError(error);
            };
        }
        return "地址解析失败: " + friendlyError(error);
    }

    private Mono<FootprintImportResult> createFootprints(
        List<FootprintImportRow> items
    ) {
        AtomicInteger created = new AtomicInteger();
        AtomicInteger failed = new AtomicInteger();
        return Flux.fromIterable(items)
            .concatMap(item -> {
                if (!"valid".equals(item.getStatus())) {
                    return Mono.just(item);
                }
                Footprint footprint = toFootprint(item);
                return client.create(footprint)
                    .doOnSuccess(createdFootprint -> {
                        created.incrementAndGet();
                        mark(item, "success", null);
                    })
                    .onErrorResume(e -> {
                        failed.incrementAndGet();
                        log.warn(
                            "批量导入第 {} 行写入失败: {}",
                            item.getRowNumber(),
                            e.getMessage()
                        );
                        mark(item, "failed", "写入失败: " + friendlyError(e));
                        return Mono.empty();
                    })
                    .thenReturn(item);
            })
            .collectList()
            .map(resultItems -> {
                FootprintImportResult result = toResult(resultItems, false);
                result.setSuccess(created.get());
                result.setFailed(result.getFailed() + failed.get());
                return result;
            });
    }

    private Footprint toFootprint(FootprintImportRow item) {
        Footprint footprint = new Footprint();
        Metadata metadata = new Metadata();
        metadata.setGenerateName("footprint-import-");
        footprint.setMetadata(metadata);

        Footprint.FootprintSpec spec = new Footprint.FootprintSpec();
        spec.setName(item.getName());
        spec.setDescription(item.getDescription());
        spec.setAddress(item.getAddress());
        spec.setLongitude(item.getLongitude());
        spec.setLatitude(item.getLatitude());
        spec.setCreateTime(FootprintImportSupport.parseVisitTime(
            item.getVisitTime(),
            ZoneId.systemDefault()
        ));
        spec.setZoomLevel(DEFAULT_ZOOM_LEVEL);
        spec.setPitchAngle("0");
        spec.setRotationAngle("0");
        spec.setFootprintType(item.getFootprintType());
        spec.setImage("");
        spec.setTicketImage("");
        spec.setGalleryImages(List.of());
        spec.setProvince(item.getProvince());
        spec.setCity(item.getCity());
        spec.setProvinceAdcode(item.getProvinceAdcode());
        spec.setCityAdcode(item.getCityAdcode());
        footprint.setSpec(spec);
        return footprint;
    }

    private FootprintImportResult toResult(
        List<FootprintImportRow> items,
        boolean dryRun
    ) {
        long ready = items.stream().filter(item -> "valid".equals(item.getStatus())).count();
        long invalid = items.stream().filter(item -> "invalid".equals(item.getStatus())).count();
        long skipped = items.stream()
            .filter(item -> "duplicate".equals(item.getStatus()))
            .count();
        return FootprintImportResult.builder()
            .total(items.size())
            .ready(ready)
            .success(0)
            .failed(invalid)
            .skipped(skipped)
            .dryRun(dryRun)
            .items(items)
            .build();
    }

    private FootprintImportRow copyForProcessing(FootprintImportRow source) {
        if (source == null) {
            return FootprintImportRow.builder()
                .status("invalid")
                .message("导入行数据为空")
                .build();
        }
        return source.toBuilder()
            .status(null)
            .message(null)
            .build();
    }

    private void mark(FootprintImportRow item, String status, String message) {
        item.setStatus(status);
        item.setMessage(message);
    }

    private String friendlyError(Throwable error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.isBlank()) {
            return "未知错误";
        }
        return message.replace('\n', ' ').replace('\r', ' ').trim();
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
