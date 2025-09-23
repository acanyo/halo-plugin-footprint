package cc.lik.footprint.service;

import cc.lik.footprint.dto.BaseConfig;
import reactor.core.publisher.Mono;

public interface FootprintService {
    /**
     * 根据分组名称获取导航配置
     */
    Mono<BaseConfig> getConfigByGroupName();

    Mono<String> AddressLocationUtil(String address, String gaoDeWebKey);
}
