package cc.lik.footprint.service;

import cc.lik.footprint.dto.GeoInfo;
import reactor.core.publisher.Mono;

/**
 * 高德地理编码能力。
 *
 * <p>插件里有两类相反的查询，放在一起是因为它们共用同一套 HTTP 调用与
 * 响应解析约定：</p>
 * <ul>
 *   <li>{@link #locate}：地址 → 经纬度，供「填地址自动选点」使用；</li>
 *   <li>{@link #reverseGeocode}：经纬度 → 省/市/adcode，供足迹解析与地图选点使用。</li>
 * </ul>
 *
 * <p>Key 由调用方传入而不是在这里读配置：同一个能力可能用服务端 Key，
 * 也可能用别的来源，服务不该假设配置怎么存。Key 为空时由调用方负责拒绝。</p>
 */
public interface GaodeGeocodingService {

    /**
     * 按地址查经纬度，返回 {@code "经度,纬度"}。
     *
     * <p>先走 POI 关键字搜索（更贴近用户在地址栏里写的地点），
     * 没有结果时降级到地理编码；两者都失败则以错误结束。</p>
     */
    Mono<String> locate(String address, String webKey);

    /**
     * 逆地理编码，返回省、市与推导出的省/市级 adcode。
     *
     * <p>高德返回的 adcode 是区县级（如 440305），这里统一推导成
     * 省级 440000、市级 440300，与足迹数据里的存储口径保持一致。
     * 查询失败返回空 Mono，由调用方决定如何提示。</p>
     */
    Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String webKey);
}
