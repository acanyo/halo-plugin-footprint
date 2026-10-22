package cc.lik.footprint.service;

import cc.lik.footprint.dto.BaseConfig;
import reactor.core.publisher.Mono;

/**
 * 前台与模板所需的插件配置。
 *
 * <p>配置在 settings.yaml 里分成 base / globe3d / tianditu / ticket / cityWall /
 * imageProcess 六组，但使用方只关心「一份完整的 BaseConfig」。这里负责把六组拼起来，
 * 并把改存 Secret 的几项 Key 解析成明文。</p>
 */
public interface FootprintConfigService {

    /**
     * 读取并组装完整配置。
     *
     * <p>base 组缺失视为配置损坏（没有任何可回退的默认值），直接报错；
     * 其余分组缺失时用空节点兜底，字段各自取默认值。</p>
     */
    Mono<BaseConfig> getConfigByGroupName();
}
