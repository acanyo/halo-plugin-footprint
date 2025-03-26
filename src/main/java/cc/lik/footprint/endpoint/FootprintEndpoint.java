package cc.lik.footprint.endpoint;

import cc.lik.footprint.service.FootprintService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.router.QueryParamBuildUtil;
import run.halo.app.extension.router.SpringdocRouteBuilder;

@Component
@RequiredArgsConstructor
@Tag(name = "FootprintV1alpha1Public")
public class FootprintEndpoint implements CustomEndpoint {
    private final FootprintService footprintService;

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return SpringdocRouteBuilder.route()
            .GET("/footprint/geocode", this::geocode,
                builder -> builder
                    .operationId("GeocodeAddress")
                    .description("将地址转换为经纬度坐标")
                    .tag("FootprintV1alpha1Public")
                    .parameter(QueryParamBuildUtil.required("address", "要转换的地址"))
                    .response(responseBuilder()
                        .implementation(String.class)
                        .description("返回格式：经度,纬度")
                    )
            )
            .build();
    }

    @Operation(summary = "地址转坐标")
    private Mono<ServerResponse> geocode(ServerRequest request) {
        String address = request.queryParam("address")
            .orElseThrow(() -> new IllegalArgumentException("地址参数不能为空"));
            
        return footprintService.AddressLocationUtil(address)
            .flatMap(location -> ServerResponse.ok().bodyValue(location))
            .switchIfEmpty(ServerResponse.notFound().build());
    }
} 