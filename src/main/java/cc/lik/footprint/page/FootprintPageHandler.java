package cc.lik.footprint.page;

import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.theme.TemplateNameResolver;
import run.halo.app.theme.router.ModelConst;

import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;

import static org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR;

/** 足迹前台页 /footprints：取配置与全部足迹，交给主题模板渲染 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FootprintPageHandler {

    private final TemplateNameResolver templateNameResolver;
    private final ReactiveExtensionClient client;
    private final FootprintConfigService configService;

    public Mono<ServerResponse> render(ServerRequest request) {
        return configService.getConfigByGroupName()
            .flatMap(settings -> {
                // 按创建时间倒序排序
                Comparator<Footprint> comparator =
                    (f1, f2) -> f2.getSpec().getCreateTime()
                        .compareTo(f1.getSpec().getCreateTime());

                // 不分页取全部：原先写死 0..1000，超过 1000 条时多出的足迹会悄悄不显示
                return client.list(Footprint.class, null, comparator)
                    .collectList()
                    .flatMap(footprints -> {
                        log.debug("渲染足迹页面: {} 条足迹", footprints.size());
                        Map<String, Object> model = new HashMap<>();
                        model.put("settings", settings);
                        model.put("footprints", footprints);
                        // 给 Head 处理器等渲染扩展一个稳定的页面标识（Halo 约定）：
                        // FootprintHeadProcessor 靠它判断"这是足迹页"，才注入 3D 地球那套资源。
                        model.put(ModelConst.TEMPLATE_ID, "plugin:footprint:footprints");

                        return templateNameResolver.resolveTemplateNameOrDefault(
                                request.exchange(),
                                "footprint"
                            )
                            .flatMap(templateName -> {
                                log.debug("足迹页面使用模板: {}", templateName);
                                return ServerResponse.ok()
                                    .render(templateName, model);
                            });
                    });
            })
            .onErrorResume(e -> {
                log.error("渲染足迹页面失败", e);
                return ServerResponse.status(INTERNAL_SERVER_ERROR)
                    .bodyValue("渲染足迹页面失败: " + e.getMessage());
            });
    }
}
