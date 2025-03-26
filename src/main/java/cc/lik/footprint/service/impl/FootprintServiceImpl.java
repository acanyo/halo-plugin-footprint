package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.service.FootprintService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.ReactiveSettingFetcher;
import org.springframework.web.reactive.function.client.WebClient;

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
                    item.path("describe").asText("每一处足迹都充满了故事，那是对人生的思考和无限的风光。"),
                    item.path("hsla").asText("109,42%,60%"),
                    item.path("logoName").asText(),
                    item.path("mapStyle").asText()
                );
                return Mono.just(config);
            });
    }
    private static final String Box_Url = "https://cn.apihz.cn/api/other/jwbaidu.php";
    private static final String Box_Id = "88888888"; //公共
    private static final String Box_Key = "88888888"; //公共Key

    @Override
    public Mono<String> AddressLocationUtil(String address) {
        return WebClient.create()
                .get()
                .uri(Box_Url, uriBuilder -> uriBuilder
                        .queryParam("id", Box_Id)
                        .queryParam("key", Box_Key)
                        .queryParam("address", address)
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .mapNotNull(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if (jsonResponse.get("code").asInt() == 200) {
                            String lng = jsonResponse.get("lng").asText();
                            String lat = jsonResponse.get("lat").asText();
                            return lng + "," + lat;
                        }
                        log.warn("API返回错误: {}", jsonResponse.get("msg").asText());
                        return null;
                    } catch (Exception e) {
                        log.error("响应失败: {}", e.getMessage());
                        return null;
                    }
                })
                .onErrorResume(e -> {
                    log.error("调用百度地图API失败: {}", e.getMessage());
                    return Mono.empty();
                });
    }
}
