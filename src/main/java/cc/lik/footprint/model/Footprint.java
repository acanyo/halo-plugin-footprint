package cc.lik.footprint.model;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

import java.time.Instant;

/**
 * 足迹数据模型
 */
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@GVK(group = "footprint.lik.cc", 
     version = "v1alpha1", 
     kind = "Footprint", 
     plural = "footprints", 
     singular = "footprint")
public class Footprint extends AbstractExtension {

    @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    private FootprintSpec spec;

    @Data
    @Schema(name = "FootprintSpec")
    public static class FootprintSpec {
        /**
         * 足迹名称
         */
        @Schema(description = "足迹名称", requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 100)
        private String name;

        /**
         * 足迹描述
         */
        @Schema(description = "足迹描述", maxLength = 500)
        private String description;

        /**
         * 经度
         */
        @Schema(description = "经度", requiredMode = Schema.RequiredMode.REQUIRED, minimum = "-180", maximum = "180")
        private Double longitude;

        /**
         * 纬度
         */
        @Schema(description = "纬度", requiredMode = Schema.RequiredMode.REQUIRED, minimum = "-90", maximum = "90")
        private Double latitude;

        /**
         * 地址
         */
        @Schema(description = "地址", maxLength = 200)
        private String address;

        /**
         * 足迹类型
         */
        @Schema(description = "足迹类型")
        private String footprintType;

        /**
         * 足迹图片
         */
        @Schema(description = "足迹图片URL")
        private String image;
        /**
         * 足迹图片
         */
        @Schema(description = "管理文章URL")
        private String article;

        /**
         * 创建时间
         */
        @Schema(description = "创建时间")
        private Instant createTime;
    }
} 