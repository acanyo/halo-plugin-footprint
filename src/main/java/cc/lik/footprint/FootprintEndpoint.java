package cc.lik.footprint;

import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintService;
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
import static org.springframework.http.MediaType.APPLICATION_JSON;

@Component
@RequiredArgsConstructor
public class FootprintEndpoint implements CustomEndpoint {

    private final ReactiveExtensionClient client;
    private final FootprintService footprintService;
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

        return footprintService.getConfigByGroupName()
            .switchIfEmpty(Mono.error(new RuntimeException("未找到足迹配置")))
            .flatMap(config -> {
                if (config.getGaoDeWebKey() == null || config.getGaoDeWebKey().trim().isEmpty()) {
                    return Mono.error(new RuntimeException("高德地图Key未配置"));
                }
                return footprintService.AddressLocationUtil(address, config.getGaoDeWebKey());
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

    private Mono<ServerResponse> getStats(ServerRequest request) {
        return footprintService.getStats()
            .flatMap(stats -> ServerResponse.ok().bodyValue(stats))
            .onErrorResume(e -> {
                log.error("获取足迹统计失败: {}", e.getMessage());
                return ServerResponse.status(500).bodyValue("获取足迹统计失败: " + e.getMessage());
            });
    }

    private Mono<ServerResponse> geocodeFootprint(ServerRequest request) {
        String name = request.pathVariable("name");

        return footprintService.getConfigByGroupName()
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
                        return footprintService.reverseGeocode(lng, lat, config.getGaoDeWebKey())
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
