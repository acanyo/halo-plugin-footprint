package cc.lik.footprint.service.impl;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GaodeGeocodingServiceImplTest {

    @Test
    @DisplayName("完整地址只提取地级市，不把省和市一起传给高德")
    void extractsCityAfterProvince() {
        assertThat(GaodeGeocodingServiceImpl.extractCity("浙江省杭州市西湖区灵隐寺"))
            .isEqualTo("杭州市");
        assertThat(GaodeGeocodingServiceImpl.extractCity("广西壮族自治区桂林市阳朔县"))
            .isEqualTo("桂林市");
    }

    @Test
    @DisplayName("地址直接从城市开始时也能识别")
    void extractsCityAtStart() {
        assertThat(GaodeGeocodingServiceImpl.extractCity("杭州市西湖区"))
            .isEqualTo("杭州市");
        assertThat(GaodeGeocodingServiceImpl.extractCity("北京市朝阳区"))
            .isEqualTo("北京市");
    }

    @Test
    @DisplayName("没有城市信息时返回空")
    void returnsNullWithoutCity() {
        assertThat(GaodeGeocodingServiceImpl.extractCity("灵隐寺")).isNull();
        assertThat(GaodeGeocodingServiceImpl.extractCity("")).isNull();
    }

    @Test
    @DisplayName("识别 QPS、每日额度和无效 Key")
    void classifiesGaodeApiFailures() {
        GaodeApiException qps = GaodeApiException.from(
            "CUQPS_HAS_EXCEEDED_THE_LIMIT 10021",
            "高德请求过于频繁"
        );
        GaodeApiException daily = GaodeApiException.from(
            "DAILY_QUERY_OVER_LIMIT 10003",
            "调用量超出限制"
        );
        GaodeApiException invalidKey = GaodeApiException.from(
            "INVALID_USER_KEY 10001",
            "Key 不正确"
        );

        assertThat(qps.getKind()).isEqualTo(GaodeApiException.Kind.RATE_LIMIT);
        assertThat(qps.isRateLimit()).isTrue();
        assertThat(daily.getKind()).isEqualTo(GaodeApiException.Kind.DAILY_LIMIT);
        assertThat(invalidKey.getKind()).isEqualTo(GaodeApiException.Kind.INVALID_KEY);
        assertThat(qps.isGlobalFailure()).isTrue();
    }
}
