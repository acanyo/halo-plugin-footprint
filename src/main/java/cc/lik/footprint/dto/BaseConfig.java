package cc.lik.footprint.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class BaseConfig {
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
    private String globeTitle;
    private String globeDesc;
    private String tiandituKey;
    private Boolean enableTerrainDefault;
    private String ticketGalleryStyle;
    private String ticketGalleryInfoStyle;
    private Integer mobileCityWallColumns;
    private Boolean enableTimeCapsule;
    private Boolean enableInsight;
    private Boolean cityCardHoverCarousel;
    private Boolean enablePostcard;
    private String markerImageFrom;
    private String markerImageTo;
    private String markerImageSuffix;
    private String timelineImageFrom;
    private String timelineImageTo;
    private String timelineImageSuffix;
    private String cityWallImageFrom;
    private String cityWallImageTo;
    private String cityWallImageSuffix;
    private Boolean enableTicketJourneyReplay;
    private Boolean enableTicketSeasonLight;
    private Boolean enableTicketOracle;
    private Boolean enableTicketLetter;
    private Boolean enableTicketPassport;
    /** 3D 地球常驻地名标注：off 关闭 / city 只显示城市名 / all 城市名 + 足迹名 */
    private String globeLabels;
}
