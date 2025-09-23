package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.service.FootprintService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.ReactiveSettingFetcher;

@Component
@EnableScheduling
@AllArgsConstructor
@Slf4j
public class FootprintServiceImpl implements FootprintService {
    private final ReactiveSettingFetcher settingFetcher;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public Mono<BaseConfig> getConfigByGroupName() {
        return settingFetcher.get("base")
            .switchIfEmpty(Mono.error(new RuntimeException("配置不存在")))
            .flatMap(item -> {
                BaseConfig config = new BaseConfig(
                    item.path("title").asText("Handsome足迹"),
                    item.path("gaoDeKey").asText(),
                    item.path("gaoDeWebKey").asText(),
                    item.path("describe").asText("每一处足迹都充满了故事，那是对人生的思考和无限的风光。"),
                    item.path("hsla").asText("109,42%,60%"),
                    item.path("logoName").asText(),
                    item.path("mapStyle").asText()
                );
                return Mono.just(config);
            });
    }
    private static final String GAODE_URL = "https://restapi.amap.com/v3/geocode/geo";
    @Override
    public Mono<String> AddressLocationUtil(String address, String gaoDeWebKey) {
        return WebClient.create()
                .get()
                .uri(GAODE_URL, uriBuilder -> uriBuilder
                        .queryParam("key", gaoDeWebKey)
                        .queryParam("address", address)
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .mapNotNull(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if ("1".equals(jsonResponse.get("status").asText())) {
                            JsonNode geocodes = jsonResponse.get("geocodes");
                            if (geocodes.isArray() && !geocodes.isEmpty()) {
                                String location = geocodes.get(0).get("location").asText();
                                String[] coordinates = location.split(",");
                                return coordinates[0] + "," + coordinates[1];
                            }
                        }
                        log.warn("高德地图API返回错误: {}", jsonResponse.get("info").asText());
                        throw new RuntimeException("高德地图API返回错误: " + jsonResponse.get("info").asText());
                    } catch (Exception e) {
                        log.error("解析高德地图响应失败: {}", e.getMessage());
                        throw new RuntimeException("解析高德地图响应失败: " + e.getMessage());
                    }
                })
                .onErrorResume(e -> {
                    log.error("调用高德地图API失败: {}", e.getMessage());
                    return Mono.empty();
                });
    }
}
