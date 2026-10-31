package cc.lik.footprint;

import cc.lik.footprint.imageproxy.ImageProxyHandler;
import cc.lik.footprint.page.FootprintPageHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;

/** 前台路由注册：只做 URL → 处理器的映射，处理逻辑各在其包内 */
@Configuration
@RequiredArgsConstructor
public class FootprintRouter {

    private final FootprintPageHandler pageHandler;
    private final ImageProxyHandler imageProxyHandler;

    @Bean
    RouterFunction<ServerResponse> footprintRouterFunction() {
        return route(GET("/footprints"), pageHandler::render)
            .andRoute(GET("/footprints/image-proxy"), imageProxyHandler::handle);
    }
}
