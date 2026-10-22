package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintStatsService;
import cc.lik.footprint.stats.FootprintStatsAggregator;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;

import java.util.List;

/**
 * 统计服务：取全量足迹，交给纯函数聚合。
 *
 * <p>聚合口径见 {@link FootprintStatsAggregator}，这里只负责取数据。</p>
 */
@Component
@RequiredArgsConstructor
public class FootprintStatsServiceImpl implements FootprintStatsService {

    private final ReactiveExtensionClient client;

    @Override
    public Mono<StatsResult> getStats() {
        return client.list(Footprint.class, fp -> true, null)
            .collectList()
            .map(FootprintStatsAggregator::aggregate);
    }
}
