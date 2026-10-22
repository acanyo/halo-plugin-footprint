package cc.lik.footprint.service;

import cc.lik.footprint.dto.StatsResult;
import reactor.core.publisher.Mono;

/**
 * 足迹统计。
 *
 * <p>聚合口径（adcode 归一化、省份城市去重、按数量降序）由
 * {@code cc.lik.footprint.stats.FootprintStatsAggregator} 定义，
 * 前台管理页的覆盖率面板与仪表盘小组件都消费同一份额度。</p>
 */
public interface FootprintStatsService {

    Mono<StatsResult> getStats();
}
