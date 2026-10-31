package cc.lik.footprint.guestbook;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.Assert;
import reactor.core.publisher.Mono;
import run.halo.app.content.comment.CommentSubject;
import run.halo.app.extension.GroupVersionKind;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Ref;
import run.halo.app.infra.ExternalLinkProcessor;

/**
 * 留言板作为 Halo 的评论主体：后台「评论」列表里显示「足迹留言板」，
 * 评论通知里的链接指回 {@code /footprints}。
 */
@Component
@RequiredArgsConstructor
public class GuestbookCommentSubject implements CommentSubject<FootprintGuestbook> {

    private final ReactiveExtensionClient client;

    private final ExternalLinkProcessor externalLinkProcessor;

    @Override
    public Mono<FootprintGuestbook> get(String name) {
        return client.fetch(FootprintGuestbook.class, name);
    }

    @Override
    public Mono<SubjectDisplay> getSubjectDisplay(String name) {
        return get(name).map(guestbook -> new SubjectDisplay(
            "足迹留言板", externalLinkProcessor.processLink("/footprints"), "足迹"));
    }

    @Override
    public boolean supports(Ref ref) {
        Assert.notNull(ref, "Subject ref must not be null.");
        return GroupVersionKind.fromExtension(FootprintGuestbook.class)
            .equals(new GroupVersionKind(ref.getGroup(), ref.getVersion(), ref.getKind()));
    }
}
