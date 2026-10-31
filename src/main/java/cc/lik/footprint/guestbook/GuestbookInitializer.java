package cc.lik.footprint.guestbook;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;

/**
 * 插件启动时确保留言板那一条存在。已经有了就什么都不做；创建失败只记日志，
 * 不影响插件启动（留言板打不开，其它功能照常）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GuestbookInitializer {

    private final ReactiveExtensionClient client;

    public Mono<Void> ensure() {
        return client.fetch(FootprintGuestbook.class, FootprintGuestbook.NAME)
            .switchIfEmpty(Mono.defer(() -> {
                var guestbook = new FootprintGuestbook();
                var metadata = new Metadata();
                metadata.setName(FootprintGuestbook.NAME);
                guestbook.setMetadata(metadata);
                return client.create(guestbook)
                    .doOnNext(created -> log.info("已创建足迹留言板"));
            }))
            .onErrorResume(e -> {
                log.error("创建足迹留言板失败，留言板将无法评论", e);
                return Mono.empty();
            })
            .then();
    }
}
