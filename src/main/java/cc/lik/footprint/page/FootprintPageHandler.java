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
        log.info("开始渲染足迹页面");
        return configService.getConfigByGroupName()
            .flatMap(settings -> {
                log.info("已加载足迹页面配置");
                // 按创建时间倒序排序
                Comparator<Footprint> comparator =
                    (f1, f2) -> f2.getSpec().getCreateTime()
                        .compareTo(f1.getSpec().getCreateTime());

                return client.list(Footprint.class,
                        null,
                        comparator,
                        0,
                        1000) // 获取所有足迹
                    .flatMap(footprints -> {
                        log.info("获取到足迹数据: {} 条", footprints.getItems().size());
                        Map<String, Object> model = new HashMap<>();
                        model.put("settings", settings);
                        model.put("footprints", footprints.getItems());
                        // 给 Head 处理器等渲染扩展一个稳定的页面标识（Halo 约定）：
                        // FootprintHeadProcessor 靠它判断"这是足迹页"，才注入 3D 地球那套资源。
                        model.put(ModelConst.TEMPLATE_ID, "plugin:footprint:footprints");

                        return templateNameResolver.resolveTemplateNameOrDefault(
                                request.exchange(),
                                "footprint"
                            )
                            .flatMap(templateName -> {
                                log.info("使用模板: {}", templateName);
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
