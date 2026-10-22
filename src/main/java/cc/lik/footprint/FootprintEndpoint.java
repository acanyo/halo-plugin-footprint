package cc.lik.footprint;

import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.MapConfig;
import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintConfigService;
import cc.lik.footprint.service.FootprintStatsService;
import cc.lik.footprint.service.GaodeGeocodingService;
import lombok.RequiredArgsConstructor;
import org.springdoc.webflux.core.fn.SpringdocRouteBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.RequestPredicates;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.ListResult;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.router.QueryParamBuildUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.function.Predicate;

import static org.springdoc.core.fn.builders.apiresponse.Builder.responseBuilder;
import static org.springdoc.core.fn.builders.parameter.Builder.parameterBuilder;
import static org.springframework.http.MediaType.APPLICATION_JSON;

@Component
@RequiredArgsConstructor
public class FootprintEndpoint implements CustomEndpoint {

    private final ReactiveExtensionClient client;
    private final FootprintConfigService configService;
    private final FootprintStatsService statsService;
    private final GaodeGeocodingService geocodingService;
    private final String footprintTag = "footprint.lik.cc/v1alpha1/footprints";
    private static final Logger log = LoggerFactory.getLogger(FootprintEndpoint.class);

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return SpringdocRouteBuilder.route()
            .GET("/footprints", this::listFootprints, builder -> {
                builder.operationId("ListFootprints")
                    .tag(footprintTag)
                    .description("List footprints")
                    .response(responseBuilder()
                        .implementation(ListResult.generateGenericClass(Footprint.class)));
                FootprintQuery.buildParameters(builder);
            })
            .GET("/footprints/location/{address}", this::getLocation, builder -> {
                builder.operationId("GetLocation")
                    .tag(footprintTag)
                    .description("根据地址获取经纬度信息")
                    .response(responseBuilder()
                        .implementation(String.class)
                        .description("返回经纬度信息，格式：经度,纬度"));
            })
            .GET("/footprints/stats", this::getStats, builder -> {
                builder.operationId("GetStats")
                    .tag(footprintTag)
                    .description("获取足迹统计信息")
                    .response(responseBuilder()
                        .implementation(StatsResult.class));
            })
            .POST("/footprints/{name}/geocode", this::geocodeFootprint, builder -> {
                builder.operationId("GeocodeFootprint")
                    .tag(footprintTag)
                    .description("对指定足迹执行逆地理编码")
                    .response(responseBuilder()
                        .implementation(GeoInfo.class));
            })
            .GET("/footprints/-/reverse-geocode", this::reverseGeocode, builder -> {
                builder.operationId("ReverseGeocode")
                    .tag(footprintTag)
                    .description("对任意经纬度执行逆地理编码，不要求足迹已保存，供控制台地图选点使用")
                    .parameter(parameterBuilder().name("longitude")
                        .description("经度")
                        .required(true))
                    .parameter(parameterBuilder().name("latitude")
                        .description("纬度")
                        .required(true))
                    .response(responseBuilder()
                        .implementation(GeoInfo.class));
            })
            .GET("/footprints/-/map-config", this::getMapConfig, builder -> {
                builder.operationId("GetMapConfig")
                    .tag(footprintTag)
                    .description("获取控制台地图选点所需配置（仅浏览器端安全字段）")
                    .response(responseBuilder()
                        .implementation(MapConfig.class));
            })
            .build();
    }

    private Mono<ServerResponse> listFootprints(ServerRequest request) {
        FootprintQuery query = new FootprintQuery(request);
        
        Predicate<Footprint> predicate = footprint -> {
            if (query.getKeyword() != null && !query.getKeyword().isEmpty()) {
                String kw = query.getKeyword();
                String name = footprint.getSpec().getName();
                String province = footprint.getSpec().getProvince();
                String city = footprint.getSpec().getCity();
                boolean nameMatch = name != null && name.contains(kw);
                boolean provinceMatch = province != null && province.contains(kw);
                boolean cityMatch = city != null && city.contains(kw);
                if (!nameMatch && !provinceMatch && !cityMatch) {
                    return false;
                }
            }
            
            if (query.getFootprintType() != null && !query.getFootprintType().isEmpty()) {
                if (footprint.getSpec().getFootprintType() == null || 
                    !footprint.getSpec().getFootprintType().equals(query.getFootprintType())) {
                    return false;
                }
            }
            
            return true;
        };
        
        return client.list(Footprint.class, predicate, query.toComparator())
            .collectList()
            .map(list -> {
                int page = query.getPage();
                int size = query.getSize();
                int total = list.size();
                
                int fromIndex = (page - 1) * size;
                int toIndex = Math.min(fromIndex + size, total);
                
                List<Footprint> items = fromIndex < toIndex ? list.subList(fromIndex, toIndex) : List.of();
                
                return new ListResult<>(page, size, total, items);
            })
            .flatMap(listResult -> ServerResponse.ok().bodyValue(listResult));
    }


    private Mono<ServerResponse> getLocation(ServerRequest request) {
        String address = request.pathVariable("address");
        if (address.trim().isEmpty()) {
            return ServerResponse.badRequest().bodyValue("地址参数不能为空");
        }

        return configService.getConfigByGroupName()
            .switchIfEmpty(Mono.error(new RuntimeException("未找到足迹配置")))
            .flatMap(config -> {
                if (config.getGaoDeWebKey() == null || config.getGaoDeWebKey().trim().isEmpty()) {
                    return Mono.error(new RuntimeException("高德地图Key未配置"));
                }
                return geocodingService.locate(address, config.getGaoDeWebKey());
            })
            .flatMap(location -> ServerResponse.ok().bodyValue(location))
            .onErrorResume(e -> {
                log.error("获取地址位置失败: {}", e.getMessage());
                if (e instanceof RuntimeException) {
                    return ServerResponse.badRequest().bodyValue(e.getMessage());
                }
                return ServerResponse.status(500).bodyValue("获取地址位置失败: " + e.getMessage());
            });
    }

    /**
     * 对任意经纬度做逆地理编码。与 {@link #geocodeFootprint} 的区别是不要求足迹已存在，
     * 因此控制台在「新建」状态下就能拿到省/市，不必先保存再解析。
     */
    private Mono<ServerResponse> reverseGeocode(ServerRequest request) {
        double longitude;
        double latitude;
        try {
            longitude = Double.parseDouble(request.queryParam("longitude").orElseThrow());
            latitude = Double.parseDouble(request.queryParam("latitude").orElseThrow());
        } catch (Exception e) {
            return ServerResponse.badRequest().bodyValue("经纬度参数缺失或格式不正确");
        }
        if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
            return ServerResponse.badRequest().bodyValue("经纬度超出有效范围");
        }

        return configService.getConfigByGroupName()
            .switchIfEmpty(Mono.error(new RuntimeException("未找到足迹配置")))
            .flatMap(config -> {
                if (config.getGaoDeWebKey() == null || config.getGaoDeWebKey().trim().isEmpty()) {
                    return Mono.error(new RuntimeException("高德地图Key未配置"));
                }
                return geocodingService.reverseGeocode(longitude, latitude,
                    config.getGaoDeWebKey());
            })
            .flatMap(geoInfo -> ServerResponse.ok().bodyValue(geoInfo))
            .switchIfEmpty(Mono.defer(() -> ServerResponse.badRequest().bodyValue("逆地理编码失败")))
            .onErrorResume(e -> {
                log.error("逆地理编码失败: {}", e.getMessage());
                if (e instanceof RuntimeException) {
                    return ServerResponse.badRequest().bodyValue(e.getMessage());
                }
                return ServerResponse.status(500).bodyValue("逆地理编码失败: " + e.getMessage());
            });
    }

    /**
     * 只下发浏览器端可见的地图配置。刻意不返回整个 BaseConfig——其中的
     * gaoDeWebKey 是服务端 Key，泄漏到浏览器等同公开。
     */
    private Mono<ServerResponse> getMapConfig(ServerRequest request) {
        return configService.getConfigByGroupName()
            .switchIfEmpty(Mono.error(new RuntimeException("未找到足迹配置")))
            .map(config -> new MapConfig(config.getGaoDeKey(), config.getMapStyle()))
            .flatMap(mapConfig -> ServerResponse.ok().bodyValue(mapConfig))
            .onErrorResume(e -> {
                log.error("获取地图配置失败: {}", e.getMessage());
                return ServerResponse.status(500).bodyValue("获取地图配置失败: " + e.getMessage());
            });
    }

    private Mono<ServerResponse> getStats(ServerRequest request) {
        return statsService.getStats()
            .flatMap(stats -> ServerResponse.ok().bodyValue(stats))
            .onErrorResume(e -> {
                log.error("获取足迹统计失败: {}", e.getMessage());
                return ServerResponse.status(500).bodyValue("获取足迹统计失败: " + e.getMessage());
            });
    }

    private Mono<ServerResponse> geocodeFootprint(ServerRequest request) {
        String name = request.pathVariable("name");

        return configService.getConfigByGroupName()
            .switchIfEmpty(Mono.error(new RuntimeException("未找到足迹配置")))
            .flatMap(config -> {
                if (config.getGaoDeWebKey() == null || config.getGaoDeWebKey().trim().isEmpty()) {
                    return Mono.error(new RuntimeException("高德地图Key未配置"));
                }
                return client.get(Footprint.class, name)
                    .switchIfEmpty(Mono.error(new RuntimeException("足迹不存在: " + name)))
                    .flatMap(footprint -> {
                        Double lng = footprint.getSpec().getLongitude();
                        Double lat = footprint.getSpec().getLatitude();
                        if (lng == null || lat == null) {
                            return Mono.error(new RuntimeException("足迹缺少经纬度信息"));
                        }
                        return geocodingService.reverseGeocode(lng, lat, config.getGaoDeWebKey())
                            .flatMap(geoInfo -> {
                                if (geoInfo == null) {
                                    return Mono.error(new RuntimeException("逆地理编码失败"));
                                }
                                footprint.getSpec().setProvince(geoInfo.getProvince());
                                footprint.getSpec().setCity(geoInfo.getCity());
                                footprint.getSpec().setProvinceAdcode(geoInfo.getProvinceAdcode());
                                footprint.getSpec().setCityAdcode(geoInfo.getCityAdcode());
                                return client.update(footprint)
                                    .thenReturn(geoInfo);
                            });
                    });
            })
            .flatMap(geoInfo -> ServerResponse.ok().bodyValue(geoInfo))
            .onErrorResume(e -> {
                log.error("逆地理编码失败: {}", e.getMessage());
                if (e instanceof RuntimeException) {
                    return ServerResponse.badRequest().bodyValue(e.getMessage());
                }
                return ServerResponse.status(500).bodyValue("逆地理编码失败: " + e.getMessage());
            });
    }

    @Override
    public GroupVersion groupVersion() {
        return GroupVersion.parseAPIVersion("api.footprint.lik.cc/v1alpha1");
    }
}
