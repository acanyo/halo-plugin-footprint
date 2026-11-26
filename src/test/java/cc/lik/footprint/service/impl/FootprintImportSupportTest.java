package cc.lik.footprint.service.impl;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FootprintImportSupportTest {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    @Test
    @DisplayName("本地日期时间按指定时区转换，支持可选秒")
    void parsesLocalVisitTime() {
        assertThat(FootprintImportSupport.parseVisitTime("2024-05-01T00:00", ZONE))
            .isEqualTo(Instant.parse("2024-04-30T16:00:00Z"));
        assertThat(FootprintImportSupport.parseVisitTime("2024-05-01T14:30:45", ZONE))
            .isEqualTo(Instant.parse("2024-05-01T06:30:45Z"));
    }

    @Test
    @DisplayName("带时区偏移和 Z 的时间直接解析")
    void parsesOffsetVisitTime() {
        assertThat(FootprintImportSupport.parseVisitTime("2024-05-01T14:30:00+08:00", ZONE))
            .isEqualTo(Instant.parse("2024-05-01T06:30:00Z"));
        assertThat(FootprintImportSupport.parseVisitTime("2024-05-01T06:30:00Z", ZONE))
            .isEqualTo(Instant.parse("2024-05-01T06:30:00Z"));
    }

    @Test
    @DisplayName("非法时间给出可展示的错误")
    void rejectsInvalidVisitTime() {
        assertThatThrownBy(() -> FootprintImportSupport.parseVisitTime("2024/05/01", ZONE))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("格式不正确");
    }

    @Test
    @DisplayName("重复键忽略名称和地址两侧空白以及连续空白")
    void buildsStableDuplicateKey() {
        Instant time = Instant.parse("2024-05-01T00:00:00Z");
        assertThat(FootprintImportSupport.duplicateKey("  西湖 ", " 杭州市  西湖区 ", time))
            .isEqualTo(FootprintImportSupport.duplicateKey("西湖", "杭州市 西湖区", time));
    }

    @Test
    @DisplayName("解析高德经纬度字符串")
    void parsesLocation() {
        assertThat(FootprintImportSupport.parseLocation("120.1,30.2"))
            .containsExactly(120.1, 30.2);
    }
}
