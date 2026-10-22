package cc.lik.footprint.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * <p>插件前台运行所需的全部配置，由 {@code FootprintConfigService#getConfigByGroupName()}
 * 从多个 Setting 分组汇总而成。</p>
 *
 * <p>这里使用 {@code @Builder} 而非位置参数构造：本类字段多达 37 个且大量为
 * String / Boolean，用位置参数装配时相邻的同类型字段一旦错位，编译期不会报错，
 * 只会在前台表现为「配置串了」，排查成本极高。</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BaseConfig {
    // 基本设置（group: base）
    private String title;
    private String gaoDeKey;
    private String gaoDeWebKey;
    private String describe;
    private String hsla;
    private String logoName;
    private String mapStyle;
    private String markerStyle;
    private Boolean enableHoverZoom;
    private String highlightScheme;
    private Boolean highlightVisitedCities;
    private Integer photoWallPageSize;
    private String photoWallStyle;

    // 3D 地球（group: globe3d）
    private String globeTitle;
    private String globeDesc;
    /** 3D 地球常驻地名标注：off 关闭 / city 只显示城市名 / all 城市名 + 足迹名 */
    private String globeLabels;

    // 天地图（group: tianditu）
    private String tiandituKey;
    private Boolean enableTerrainDefault;

    // 票根页（group: ticket）
    private String ticketGalleryStyle;
    private Boolean enableTicketJourneyReplay;
    private Boolean enableTicketSeasonLight;
    private Boolean enableTicketOracle;
    private Boolean enableTicketLetter;
    private Boolean enableTicketPassport;

    // 城市卡片墙（group: cityWall）
    private Integer mobileCityWallColumns;
    private Boolean enableTimeCapsule;
    private Boolean enableInsight;
    private Boolean cityCardHoverCarousel;
    private Boolean enablePostcard;

    // 图片处理（group: imageProcess）
    private String markerImageFrom;
    private String markerImageTo;
    private String markerImageSuffix;
    private String timelineImageFrom;
    private String timelineImageTo;
    private String timelineImageSuffix;
    private String cityWallImageFrom;
    private String cityWallImageTo;
    private String cityWallImageSuffix;
}
