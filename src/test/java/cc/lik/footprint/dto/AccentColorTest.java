package cc.lik.footprint.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 主题色换算与前台 shared/accent.js 的单测用同一组样例：两边结果必须一致，
 * 否则后端下发的颜色和前台兜底算出来的会差一点。
 */
class AccentColorTest {

    @Test
    @DisplayName("旧的 h,s%,l% 三元组换成 #rrggbb")
    void convertsLegacyHslTriplet() {
        assertThat(AccentColor.normalize("322,68%,60%")).isEqualTo("#de54ab");
        assertThat(AccentColor.normalize("109,68%,60%")).isEqualTo("#6dde54");
        assertThat(AccentColor.normalize(" 0 , 0% , 100% ")).isEqualTo("#ffffff");
        assertThat(AccentColor.normalize("hsl(322deg, 68%, 60%)")).isEqualTo("#de54ab");
    }

    @Test
    @DisplayName("取色组件存的 hex 统一小写、补全三位写法")
    void normalizesHex() {
        assertThat(AccentColor.normalize("#7C7BC0")).isEqualTo("#7c7bc0");
        assertThat(AccentColor.normalize("#abc")).isEqualTo("#aabbcc");
        assertThat(AccentColor.normalize("7c7bc0")).isEqualTo("#7c7bc0");
    }

    @Test
    @DisplayName("认不出来的值用默认淡紫")
    void fallsBackToDefault() {
        for (String bad : new String[] {null, "", "red", "322,68,60", "#12345"}) {
            assertThat(AccentColor.normalize(bad)).as(String.valueOf(bad)).isEqualTo(AccentColor.DEFAULT);
        }
    }
}
