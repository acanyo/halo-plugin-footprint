package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.service.FootprintService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.ReactiveSettingFetcher;
import java.util.ArrayList;
import java.util.List;

@Component
@EnableScheduling
@AllArgsConstructor
@Slf4j
public class FootprintServiceImpl implements FootprintService {
    private final ReactiveSettingFetcher settingFetcher;

    @Override
    public Mono<BaseConfig> getConfigByGroupName() {
        return settingFetcher.get("base")
            .switchIfEmpty(Mono.error(new RuntimeException("配置不存在")))
            .flatMap(item -> {
                BaseConfig config = new BaseConfig(
                    item.path("title").asText("Handsome足迹"),
                    item.path("gaoDeKey").asText(),
                    item.path("describe").asText("每一处足迹都充满了故事，那是对人生的思考和无限的风光。"),
                    item.path("hsla").asText("109deg 42% 60%"),
                    item.path("logoName").asText(),
                    item.path("mapStyle").asText("109deg 42% 60%")
                );
                return Mono.just(config);
            });
    }
}
