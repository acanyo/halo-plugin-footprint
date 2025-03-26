package cc.lik.footprint;

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
                    .description("Get location by address")
                    .response(responseBuilder()
                        .implementation(String.class));
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


    private Mono<ServerResponse> getLocation(ServerRequest request) {
        String address = request.pathVariable("address");
        return footprintService.AddressLocationUtil(address)
            .flatMap(location -> ServerResponse.ok().bodyValue(location))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    @Override
    public GroupVersion groupVersion() {
        return GroupVersion.parseAPIVersion("api.footprint.lik.cc/v1alpha1");
    }
}
