package cc.lik.footprint.guestbook;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

/**
 * 足迹页留言板：整页只有一个，Halo 评论挂在它上面。
 *
 * <p>Halo 的评论必须指向一个模型实例（{@code subjectRef}），而足迹页本身不是任何模型，
 * 所以单独建一个只有名字、没有字段的模型当「评论主体」。插件启动时确保名为
 * {@link #NAME} 的那一条存在（见 {@code GuestbookInitializer}）。</p>
 */
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@GVK(group = "footprint.lik.cc",
    version = "v1alpha1",
    kind = "FootprintGuestbook",
    plural = "footprintguestbooks",
    singular = "footprintguestbook")
public class FootprintGuestbook extends AbstractExtension {

    /** 唯一的那一条留言板的名字，前台评论组件的 name 也写它 */
    public static final String NAME = "footprints";
}
