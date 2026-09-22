package cc.lik.footprint.service;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.StatsResult;
import reactor.core.publisher.Mono;
import java.util.List;

public interface FootprintService {

    Mono<BaseConfig> getConfigByGroupName();

    Mono<String> AddressLocationUtil(String address, String gaoDeWebKey);

    Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String gaoDeWebKey);

    Mono<StatsResult> getStats();
}
