package cc.lik.footprint.model;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.ToString;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

import java.time.Instant;
import java.util.List;

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
        @Schema(description = "经度", requiredMode = Schema.RequiredMode.REQUIRED, minimum = "-180"
            , maximum = "180")
        private Double longitude;

        /**
         * 纬度
         */
        @Schema(description = "纬度", requiredMode = Schema.RequiredMode.REQUIRED, minimum = "-90",
            maximum = "90")
        private Double latitude;

        /**
         * 地址
         */
        @Schema(description = "地址", maxLength = 200)
        private String address;

        /**
         * 缩放级别
         */
        @Schema(description = "缩放级别")
        private String zoomLevel;

        /**
         * 俯仰角度 0-83
         * 3D地图启用
         */
        @Schema(description = "俯仰角度")
        private String pitchAngle;

        /**
         * 旋转角度  -360到360
         * 3D地图俯启用
         */
        private String rotationAngle;

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
         * 票根图片（每个足迹最多一张）
         */
        @Schema(description = "票根图片URL")
        private String ticketImage;

        /**
         * 图片墙图片
         */
        @Schema(description = "图片墙图片及显示顺序")
        private List<GalleryImage> galleryImages;

        /**
         * 足迹图片
         */
        @Schema(description = "管理文章URL")
        private String article;

        /**
         * 关联足迹列表
         */
        @Schema(description = "关联足迹列表")
        private List<String> metadataNames;

        /**
         * 创建时间
         */
        @Schema(description = "创建时间")
        private Instant createTime;

        @Schema(description = "省级行政区")
        private String province;

        @Schema(description = "城市")
        private String city;

        @Schema(description = "省级行政区编码")
        private String provinceAdcode;

        @Schema(description = "城市编码")
        private String cityAdcode;
    }

    /**
     * 图片墙图片
     *
     * <p>保留 String 构造方法以兼容旧版本保存的 URL 字符串数组。</p>
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Schema(name = "GalleryImage")
    public static class GalleryImage {
        @Schema(description = "图片地址", requiredMode = Schema.RequiredMode.REQUIRED)
        private String url;

        @Schema(description = "图片墙显示顺序", requiredMode = Schema.RequiredMode.REQUIRED)
        private Integer order;

        @com.fasterxml.jackson.annotation.JsonCreator(mode = com.fasterxml.jackson.annotation.JsonCreator.Mode.DELEGATING)
        public GalleryImage(String url) {
            this.url = url;
            this.order = 0;
        }
    }
}
