/**
 * 前台数据契约。
 *
 * 这些类型直接对应服务端两处产物：
 * - `FootprintSpec` ← `cc.lik.footprint.model.Footprint.FootprintSpec`
 * - `FootprintConfig` ← `footprint.html` 里注入的 `window.FOOTPRINT_CONFIG`，
 *   其字段由 `cc.lik.footprint.dto.BaseConfig` 决定
 *
 * 改动后端对应类时务必同步这里，否则组件只会静默拿到 undefined。
 */

export interface GalleryImage {
  url: string;
  order?: number;
}

export interface FootprintSpec {
  name: string;
  description?: string;
  longitude: number;
  latitude: number;
  address?: string;
  footprintType?: string;
  image?: string;
  ticketImage?: string;
  galleryImages?: GalleryImage[] | string[];
  article?: string;
  zoomLevel?: string;
  pitchAngle?: string;
  rotationAngle?: string;
  createTime?: string;
  province?: string;
  city?: string;
  provinceAdcode?: string;
  cityAdcode?: string;
}

export interface FootprintMetadata {
  name: string;
  creationTimestamp?: string;
}

export interface Footprint {
  metadata: FootprintMetadata;
  spec: FootprintSpec;
}

/** 图片处理规则：把原图 URL 换成图床的缩略图 URL */
export interface ImageRule {
  from: string;
  to: string;
  suffix: string;
}

export interface FootprintConfig {
  amapKey: string;
  footprints: Footprint[];
  title: string;
  logoName: string;
  describe: string;
  hsla: string;
  mapStyle: string;
  markerStyle: string;
  enableHoverZoom: boolean;
  highlightScheme: string;
  highlightVisitedCities: boolean;
  photoWallPageSize: number;
  photoWallStyle: string;

  globeTitle: string;
  globeDesc: string;
  globeLabels: string;

  tiandituKey: string;
  enableTerrainDefault: boolean;

  ticketGalleryStyle: 'fan' | 'strip';
  enableTicketJourneyReplay: boolean;
  enableTicketSeasonLight: boolean;
  enableTicketOracle: boolean;
  enableTicketLetter: boolean;
  enableTicketPassport: boolean;

  mobileCityWallColumns: number;
  enableTimeCapsule: boolean;
  enableInsight: boolean;
  cityCardHoverCarousel: boolean;
  enablePostcard: boolean;

  markerImageFrom: string;
  markerImageTo: string;
  markerImageSuffix: string;
  timelineImageFrom: string;
  timelineImageTo: string;
  timelineImageSuffix: string;
  cityWallImageFrom: string;
  cityWallImageTo: string;
  cityWallImageSuffix: string;
}

declare global {
  interface Window {
    FOOTPRINT_CONFIG?: Partial<FootprintConfig>;
  }
}

/**
 * 读取页面注入的配置。
 *
 * 组件不直接访问 `window.FOOTPRINT_CONFIG`，一律经由此处，原因有二：
 * 1. demo 与单元测试里可以不依赖真实页面；
 * 2. 字段缺失时统一给默认值，避免每个组件各写一遍兜底。
 */
export function readConfig(): FootprintConfig {
  const raw = (typeof window !== 'undefined' && window.FOOTPRINT_CONFIG) || {};
  return {
    amapKey: '',
    footprints: [],
    title: '足迹',
    logoName: '足迹',
    describe: '',
    hsla: '109,42%,60%',
    mapStyle: '',
    markerStyle: 'pin',
    enableHoverZoom: true,
    highlightScheme: 'glow',
    highlightVisitedCities: true,
    photoWallPageSize: 6,
    photoWallStyle: 'original',
    globeTitle: '旅行记忆',
    globeDesc: '',
    globeLabels: 'all',
    tiandituKey: '',
    enableTerrainDefault: false,
    ticketGalleryStyle: 'fan',
    enableTicketJourneyReplay: false,
    enableTicketSeasonLight: false,
    enableTicketOracle: false,
    enableTicketLetter: false,
    enableTicketPassport: false,
    mobileCityWallColumns: 2,
    enableTimeCapsule: true,
    enableInsight: true,
    cityCardHoverCarousel: true,
    enablePostcard: true,
    markerImageFrom: '',
    markerImageTo: '',
    markerImageSuffix: '',
    timelineImageFrom: '',
    timelineImageTo: '',
    timelineImageSuffix: '',
    cityWallImageFrom: '',
    cityWallImageTo: '',
    cityWallImageSuffix: '',
    ...raw,
  } as FootprintConfig;
}

/** 灯箱展示的单张图片 */
export interface LightboxImage {
  url: string;
  caption?: string;
}
