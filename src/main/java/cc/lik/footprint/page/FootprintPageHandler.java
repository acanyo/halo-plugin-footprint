package cc.lik.footprint.page;

import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.model.FootprintGroup;
import cc.lik.footprint.model.FootprintWish;
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
import java.util.List;
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
                Comparator<Footprint> comparator = Comparator.comparing(
                    footprint -> footprint.getSpec().getCreateTime(),
                    Comparator.nullsLast(Comparator.reverseOrder())
                );

                // 不分页取全部：原先写死 0..1000，超过 1000 条时多出的足迹会悄悄不显示
                var publicGroups = client.list(FootprintGroup.class,
                        group -> {
                            String visibility = group.getSpec().getVisibility();
                            return visibility == null || visibility.isBlank()
                                || "public".equals(visibility);
                        },
                        Comparator.comparing(
                            (FootprintGroup group) -> group.getMetadata().getCreationTimestamp(),
                            Comparator.nullsLast(Comparator.reverseOrder())
                        )
                            .thenComparing(group -> group.getMetadata().getName()))
                    .collectList()
                    .onErrorResume(e -> {
                        log.error("读取足迹旅途集失败，将在前台隐藏该功能", e);
                        return Mono.just(List.of());
                    });
                var publicWishes = client.list(FootprintWish.class,
                        wish -> {
                            String visibility = wish.getSpec().getVisibility();
                            return visibility == null || visibility.isBlank()
                                || "public".equals(visibility);
                        },
                        Comparator.comparing(
                            (FootprintWish wish) -> wish.getMetadata().getCreationTimestamp(),
                            Comparator.nullsLast(Comparator.reverseOrder())
                        ).thenComparing(wish -> wish.getMetadata().getName()))
                    .collectList()
                    .onErrorResume(e -> {
                        log.error("读取未来足迹失败，将在前台隐藏该功能", e);
                        return Mono.just(List.of());
                    });
                return Mono.zip(
                        client.list(Footprint.class, null, comparator).collectList(),
                        publicGroups,
                        publicWishes
                    )
                    .flatMap(result -> {
                        List<Footprint> footprints = result.getT1();
                        List<FootprintGroup> groups = result.getT2();
                        List<FootprintWish> wishes = result.getT3();
                        log.debug("渲染足迹页面: {} 条足迹，{} 个未来足迹",
                            footprints.size(), wishes.size());
                        Map<String, Object> model = new HashMap<>();
                        model.put("settings", settings);
                        model.put("footprints", footprints);
                        model.put("footprintGroups", groups);
                        model.put("footprintWishes", wishes);
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
