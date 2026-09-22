package cc.lik.footprint.dto;

/**
 * <p>控制台地图选点所需的配置，是 {@link BaseConfig} 的浏览器端安全子集。</p>
 *
 * <p>这里**只能**放可以下发到浏览器的字段。{@code BaseConfig} 同时持有
 * {@code gaoDeWebKey}（高德 Web 服务 Key，用于服务端地理编码）与
 * {@code tiandituKey}，它们一旦进入浏览器就等同于公开，因此本 DTO 采取白名单式
 * 定义，而不是直接把 BaseConfig 丢给前端。</p>
 *
 * @param gaoDeKey 高德 JS API Key（浏览器端 Key，前台页面本就会渲染它）
 * @param mapStyle 地图样式，保持控制台选点与前台展示观感一致
 */
public record MapConfig(String gaoDeKey, String mapStyle) {
}
