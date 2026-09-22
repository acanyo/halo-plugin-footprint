import type { AxiosInstance } from "axios";
import type {Footprint, FootprintList, Option, StatsResult, GeoInfo, MapConfig} from "./models";
import {consoleApiClient} from "@halo-dev/api-client";

export class FootprintApi {
  private axios: AxiosInstance;
  private baseUrl: string = "/apis/api.plugin.halo.run/v1alpha1/plugins/footprint";

  constructor(axios: AxiosInstance) {
    this.axios = axios;
  }

  /**
   * 获取足迹列表
   */
  async listFootprints(params?: {
    page?: number;
    size?: number;
    sort?: string[];
    keyword?: string;
    footprintType?: string;
    author?: string;
  }): Promise<FootprintList> {
    const { data } = await this.axios.get(
      "/apis/api.footprint.lik.cc/v1alpha1/footprints",
      {
        params: {
          page: params?.page || 1,
          size: params?.size || 20,
          sort: params?.sort,
          keyword: params?.keyword,
          footprintType: params?.footprintType,
          author: params?.author,
        },
      }
    );
    return data;
  }

  /**
   * 获取单个足迹
   */
  async getFootprint(name: string): Promise<Footprint> {
    const { data } = await this.axios.get(
      `/apis/footprint.lik.cc/v1alpha1/footprints/${name}`
    );
    return data;
  }

  /**
   * 创建足迹
   */
  async createFootprint(footprint: Footprint): Promise<Footprint> {
    const { data } = await this.axios.post(
      "/apis/footprint.lik.cc/v1alpha1/footprints",
      footprint
    );
    return data;
  }

  async updateFootprint(name: string, footprint: Footprint): Promise<Footprint> {
    const { data } = await this.axios.put(
      `/apis/footprint.lik.cc/v1alpha1/footprints/${name}`,
      footprint
    );
    return data;
  }

  /**
   * 删除足迹
   */
  async deleteFootprint(name: string): Promise<void> {
    await this.axios.delete(`/apis/footprint.lik.cc/v1alpha1/footprints/${name}`);
  }

  /**
   * 批量删除足迹
   */
  async deleteFootprints(names: string[]): Promise<void> {
    const promises = names.map((name) => this.deleteFootprint(name));
    await Promise.all(promises);
  }

  /**
   * 获取足迹类型列表
   */
  async listFootprintTypes(): Promise<Option[]> {
    try {
      const { data } = await consoleApiClient.plugin.plugin.fetchPluginJsonConfig({
        name: 'footprint'
      });
      const { advanced } = data as any;
      const { footprintTypes = [] } = advanced || {};
      const result = footprintTypes.map((type: any) => {
        return {
          label: type,
          value: type
        };
      });
      if (result.length === 0) {
        const defaultTypes = ["旅游", "美食", "购物", "住宿", "交通", "其他"];
        return defaultTypes.map(type => ({
        label: type,
        value: type
      }));
      }
      return result;
    } catch (error) {
      console.error("错误详情:", error);
      // 返回默认的足迹类型列表作为后备方案
      const defaultTypes = ["旅游", "美食", "购物", "住宿", "交通", "其他"];
      return defaultTypes.map(type => ({
        label: type,
        value: type
      }));
    }
  }

  async getStats(): Promise<StatsResult> {
    const { data } = await this.axios.get(
      "/apis/api.footprint.lik.cc/v1alpha1/footprints/stats", { params: { _t: Date.now() } }
    );
    return data;
  }

  async geocodeFootprint(name: string): Promise<GeoInfo> {
    const { data } = await this.axios.post(
      `/apis/api.footprint.lik.cc/v1alpha1/footprints/${name}/geocode`
    );
    return data;
  }

  /**
   * 根据地址获取经纬度，返回 "经度,纬度" 文本。
   * 由服务端持有高德 Web 服务 Key 并代为请求，浏览器不直连高德。
   */
  async getLocation(address: string): Promise<string> {
    const { data } = await this.axios.get(
      `/apis/api.footprint.lik.cc/v1alpha1/footprints/location/${encodeURIComponent(address)}`
    );
    return data;
  }

  /**
   * 对任意经纬度做逆地理编码。与 geocodeFootprint 不同，它不要求足迹已保存，
   * 因此「新建」状态下的地图选点也能拿到省/市。
   */
  async reverseGeocode(longitude: number, latitude: number): Promise<GeoInfo> {
    const { data } = await this.axios.get(
      "/apis/api.footprint.lik.cc/v1alpha1/footprints/-/reverse-geocode",
      { params: { longitude, latitude } }
    );
    return data;
  }

  /**
   * 获取地图选点所需配置。服务端只返回浏览器端安全字段，不含高德 Web 服务 Key。
   */
  async getMapConfig(): Promise<MapConfig> {
    const { data } = await this.axios.get(
      "/apis/api.footprint.lik.cc/v1alpha1/footprints/-/map-config"
    );
    return data;
  }
}
