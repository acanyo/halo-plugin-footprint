package cc.lik.footprint.model;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

/**
 * 用户自定义的旅程或收藏。
 *
 * <p>成员只保存足迹的 metadata.name，不复制足迹内容。旅程与收藏的
 * 时间、距离和完成度均由前端根据成员实时派生。</p>
 */
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@GVK(group = "footprint.lik.cc",
    version = "v1alpha1",
    kind = "FootprintGroup",
    plural = "footprintgroups",
    singular = "footprintgroup")
public class FootprintGroup extends AbstractExtension {

    @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    private Spec spec;

    @Data
    @Schema(name = "FootprintGroupSpec")
    public static class Spec {

        @NotBlank
        @Pattern(regexp = "trip|collection")
        @Schema(description = "类型：trip 旅程 / collection 收藏",
            requiredMode = Schema.RequiredMode.REQUIRED)
        private String groupType;

        @NotBlank
        @Size(max = 100)
        @Schema(description = "标题",
            requiredMode = Schema.RequiredMode.REQUIRED,
            maxLength = 100)
        private String title;

        @Size(max = 1000)
        @Schema(description = "说明", maxLength = 1000)
        private String description;

        @NotBlank
        @Pattern(regexp = "public|private")
        @Schema(description = "可见性：public / private",
            requiredMode = Schema.RequiredMode.REQUIRED)
        private String visibility;

        @Schema(description = "自定义封面 URL")
        private String cover;

        @Size(max = 500)
        @Schema(description = "成员足迹的 metadata.name 列表")
        private List<String> memberNames;

        @Positive
        @Schema(description = "收藏目标总数")
        private Integer targetCount;

        @Schema(description = "关联文章或外部链接")
        private String article;

        @Size(max = 50)
        @Schema(description = "从高级设置中选择的足迹类型")
        private List<String> footprintTypes;
    }
}
