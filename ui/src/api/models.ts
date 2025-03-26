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
  /**
   * 足迹名称
   */
  name: string;

  /**
   * 足迹描述
   */
  description?: string;

  /**
   * 经度
   */
  longitude: number;

  /**
   * 纬度
   */
  latitude: number;

  /**
   * 地址
   */
  address?: string;

  /**
   * 足迹类型
   */
  footprintType?: string;

  /**
   * 足迹图片
   */
  image?: string;

  /**
   * 关联文章URL
   */
  article?: string;

  /**
   * 创建时间
   */
  createTime?: string;
}

/**
 * 足迹状态接口
 */
export interface FootprintStatus {
  /**
   * 是否已发布
   */
  published?: boolean;

  /**
   * 发布时间
   */
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