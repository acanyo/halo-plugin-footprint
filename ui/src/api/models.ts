/**
 * 元数据接口
 */
export interface Metadata {
  name: string;
  generateName?: string;
  creationTimestamp?: string;
  updateTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  version?: number;
}

/**
 * 足迹规格接口
 */
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
  metadataNames?: [];
  zoomLevel: string;
  pitchAngle: string;
  rotationAngle: string;
  createTime?: string;
  province?: string;
  city?: string;
  provinceAdcode?: string;
  cityAdcode?: string;
}

/**
 * 图片墙图片及自定义显示顺序
 */
export interface GalleryImage {
  url: string;
  order: number;
}

/**
 * 足迹状态接口
 */
export interface FootprintStatus {
  published?: boolean;
  publishTime?: string;
}

/**
 * 足迹接口
 */
export interface Footprint {
  apiVersion: string;
  kind: string;
  metadata: Metadata;
  spec: FootprintSpec;
  status?: FootprintStatus;
}

/**
 * 旅程或收藏。成员只引用 Footprint.metadata.name，时间与距离均由成员派生。
 */
export interface FootprintGroupSpec {
  groupType: "trip" | "collection";
  title: string;
  description?: string;
  visibility: "public" | "private";
  cover?: string;
  coverMemberName?: string;
  coverFocus?: "center" | "top" | "bottom" | "left" | "right";
  memberNames: string[];
  memberOrderMode?: "time" | "manual";
  sortOrder?: number;
  pinned?: boolean;
  targetCount?: number;
  article?: string;
  footprintTypes?: string[];
}

export interface FootprintGroup {
  apiVersion: string;
  kind: string;
  metadata: Metadata;
  spec: FootprintGroupSpec;
}

export interface FootprintGroupList {
  page: number;
  size: number;
  total: number;
  items: FootprintGroup[];
  first: boolean;
  last: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  totalPages: number;
}

export interface FootprintGroupApiSummary {
  group: FootprintGroup;
  memberCount: number;
  missingCount: number;
  cityCount: number;
  provinceCount: number;
  searchTerms?: string[];
  days: number;
  rangeStart?: string;
  rangeEnd?: string;
  cover?: string;
}

export type FootprintWishStatus = "wish" | "planning" | "booked" | "visited";

/**
 * 未来足迹地点。一个地点一条记录，不使用足迹成员关系。
 */
export interface FootprintWishSpec {
  title: string;
  description?: string;
  longitude: number;
  latitude: number;
  address?: string;
  province?: string;
  city?: string;
  provinceAdcode?: string;
  cityAdcode?: string;
  status: FootprintWishStatus;
  plannedYear?: number;
  plannedMonth?: number;
  plannedTimeNote?: string;
  tags?: string[];
  article?: string;
  visibility: "public" | "private";
  pinned?: boolean;
  sortOrder?: number;
  realizedFootprintName?: string;
  realizedGroupName?: string;
}

export interface FootprintWish {
  apiVersion: string;
  kind: string;
  metadata: Metadata;
  spec: FootprintWishSpec;
}

export interface FootprintWishList {
  page: number;
  size: number;
  total: number;
  items: FootprintWish[];
  first: boolean;
  last: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  totalPages: number;
}

/**
 * 足迹列表接口
 */
export interface FootprintList {
  page: number;
  size: number;
  total: number;
  items: Footprint[];
  first: boolean;
  last: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  totalPages: number;
}

/**
 * 选项
 **/
export interface Option {
  label: string;
  value: string;
}

/**
 * 省份统计
 */
export interface ProvinceStat {
  name: string;
  adcode: string;
  count: number;
  cities: string[];
}

/**
 * 城市统计
 */
export interface CityStat {
  name: string;
  adcode: string;
  province: string;
  provinceAdcode: string;
  count: number;
}

/**
 * 统计结果
 */
export interface StatsResult {
  totalFootprints: number;
  totalProvinces: number;
  totalCities: number;
  provinces: ProvinceStat[];
  cities: CityStat[];
}

/**
 * 逆地理编码结果
 */
export interface GeoInfo {
  address: string;
  province: string;
  city: string;
  provinceAdcode: string;
  cityAdcode: string;
}

/**
 * 地图选点所需配置。服务端刻意只下发这两项——高德 Web 服务 Key 属于服务端凭据，
 * 不能进入浏览器。
 */
export interface MapConfig {
  gaoDeKey: string;
  mapStyle: string;
}
