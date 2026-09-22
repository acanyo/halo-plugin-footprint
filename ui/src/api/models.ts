/**
 * 元数据接口
 */
export interface Metadata {
  name: string;
  generateName?: string;
  creationTimestamp?: string;
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
  province: string;
  city: string;
  provinceAdcode: string;
  cityAdcode: string;
}
