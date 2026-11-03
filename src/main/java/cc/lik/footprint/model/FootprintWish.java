package cc.lik.footprint.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

/**
 * 未来足迹地点。
 *
 * <p>一个地点一条记录。它不引用已访问足迹，也不参与足迹、
 * 城市、省份、天数和距离统计。</p>
 */
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@GVK(group = "footprint.lik.cc",
    version = "v1alpha1",
    kind = "FootprintWish",
    plural = "footprintwishes",
    singular = "footprintwish")
public class FootprintWish extends AbstractExtension {

    @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    private Spec spec;

    @Data
    @Schema(name = "FootprintWishSpec")
    public static class Spec {

        @NotBlank
        @Size(max = 100)
        @Schema(description = "地点名称", requiredMode = Schema.RequiredMode.REQUIRED)
        private String title;

        @Size(max = 1000)
        @Schema(description = "为什么想去")
        private String description;

        @NotNull
        @DecimalMin("-180")
        @DecimalMax("180")
        @Schema(description = "经度", requiredMode = Schema.RequiredMode.REQUIRED)
        private Double longitude;

        @NotNull
        @DecimalMin("-90")
        @DecimalMax("90")
        @Schema(description = "纬度", requiredMode = Schema.RequiredMode.REQUIRED)
        private Double latitude;

        @Size(max = 200)
        private String address;

        @Size(max = 100)
        private String province;

        @Size(max = 100)
        private String city;

        @Size(max = 32)
        private String provinceAdcode;

        @Size(max = 32)
        private String cityAdcode;

        @NotBlank
        @Pattern(regexp = "wish|planning|booked|visited")
        @Schema(description = "状态：wish / planning / booked / visited",
            requiredMode = Schema.RequiredMode.REQUIRED)
        private String status;

        @Min(1900)
        @Max(2200)
        @Schema(description = "计划年份")
        private Integer plannedYear;

        @Min(1)
        @Max(12)
        @Schema(description = "计划月份（1-12）")
        private Integer plannedMonth;

        @Size(max = 50)
        @Schema(description = "计划时间备注")
        private String plannedTimeNote;

        @Size(max = 20)
        private List<String> tags;

        @Pattern(regexp = "^$|^(https?://|/).+")
        @Size(max = 2000)
        private String article;

        @NotBlank
        @Pattern(regexp = "public|private")
        @Schema(description = "可见性：public / private",
            requiredMode = Schema.RequiredMode.REQUIRED)
        private String visibility;

        private Boolean pinned;

        @PositiveOrZero
        private Integer sortOrder;

        @Size(max = 200)
        @Schema(description = "已实现后关联的足迹 metadata.name")
        private String realizedFootprintName;

        @Size(max = 200)
        @Schema(description = "已实现后关联的旅程 metadata.name")
        private String realizedGroupName;

        @JsonIgnore
        @AssertTrue(message = "填写计划月份时必须同时填写计划年份")
        public boolean isPlannedMonthValid() {
            return plannedMonth == null || plannedYear != null;
        }
    }
}
