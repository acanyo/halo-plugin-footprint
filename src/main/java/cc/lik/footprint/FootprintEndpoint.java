package cc.lik.footprint;

import static org.springdoc.core.fn.builders.apiresponse.Builder.responseBuilder;
import static org.springframework.http.MediaType.APPLICATION_JSON;

import cc.lik.footprint.finders.FootprintFinder;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintService;
import cc.lik.footprint.vo.FootprintVo;
import java.util.List;
import java.util.function.Predicate;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springdoc.webflux.core.fn.SpringdocRouteBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.ListResult;
import run.halo.app.extension.ReactiveExtensionClient;

@Component
@RequiredArgsConstructor
public class FootprintEndpoint implements CustomEndpoint {

    private final ReactiveExtensionClient client;
    private final FootprintService footprintService;
    private final FootprintFinder footprintFinder;
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
            .GET("/listAllFootprints", this::listAllFootprints, builder -> {
                builder.operationId("ListAllFootprints")
                    .tag(footprintTag)
                    .description("获取所有足迹列表")
                    .response(responseBuilder()
                        .implementation(FootprintVo[].class)
                        .description("返回所有足迹的视图对象列表"));
            })
            .build();
    }

    private Mono<ServerResponse> listFootprints(ServerRequest request) {
        FootprintQuery query = new FootprintQuery(request);
        
        // 将ListOptions转换为Predicate
        Predicate<Footprint> predicate = footprint -> {
            // 处理关键词搜索
            if (query.getKeyword() != null && !query.getKeyword().isEmpty()) {
                if (footprint.getSpec().getName() == null || 
                    !footprint.getSpec().getName().contains(query.getKeyword())) {
                    return false;
                }
            }
            
            // 处理类型过滤
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

    /**
     * 获取所有足迹列表
     */
    private Mono<ServerResponse> listAllFootprints(ServerRequest request) {
        log.info("开始获取所有足迹列表");
        
        return footprintFinder.listAll()
            .collectList()
            .flatMap(footprints -> {
                log.info("成功获取到 {} 条足迹记录", footprints.size());
                return ServerResponse.ok()
                    .contentType(APPLICATION_JSON)
                    .bodyValue(footprints);
            })
            .onErrorResume(e -> {
                log.error("获取所有足迹列表失败", e);
                return ServerResponse.status(500)
                    .bodyValue("获取足迹列表失败: " + e.getMessage());
            });
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

    @Override
    public GroupVersion groupVersion() {
        return GroupVersion.parseAPIVersion("api.footprint.lik.cc/v1alpha1");
    }
}
