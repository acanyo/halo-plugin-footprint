package cc.lik.footprint.imageproxy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.net.URI;

import static org.assertj.core.api.Assertions.assertThat;

class ImageUrlPolicyTest {

    @Test
    @DisplayName("取域名：标准 URL 与含未编码中文的 URL 都能取到")
    void hostOf() {
        assertThat(ImageUrlPolicy.hostOf("https://img.example.com/a.png")).isEqualTo("img.example.com");
        assertThat(ImageUrlPolicy.hostOf("https://img.example.com/票根 1.png")).isEqualTo("img.example.com");
        assertThat(ImageUrlPolicy.hostOf("/upload/a.png")).isNull();
        assertThat(ImageUrlPolicy.hostOf("  ")).isNull();
        assertThat(ImageUrlPolicy.hostOf(null)).isNull();
    }

    @Test
    @DisplayName("本机与内网地址被拦截，公网地址放行")
    void blockedHost() {
        assertThat(ImageUrlPolicy.isBlockedHost("localhost")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("a.localhost")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("[::1]")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("127.0.0.1")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("10.1.2.3")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("172.16.0.1")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("172.31.255.255")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("192.168.1.1")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("169.254.169.254")).isTrue();
        assertThat(ImageUrlPolicy.isBlockedHost("172.32.0.1")).isFalse();
        assertThat(ImageUrlPolicy.isBlockedHost("8.8.8.8")).isFalse();
        assertThat(ImageUrlPolicy.isBlockedHost("img.example.com")).isFalse();
    }

    @Test
    @DisplayName("图片类型：优先用响应头，否则按去掉 ! 后缀的扩展名兜底")
    void contentType() {
        URI png = URI.create("https://x.com/a.png");
        assertThat(ImageUrlPolicy.imageContentType(MediaType.IMAGE_JPEG, png)).isEqualTo(MediaType.IMAGE_JPEG);
        assertThat(ImageUrlPolicy.imageContentType(MediaType.APPLICATION_OCTET_STREAM, png))
            .isEqualTo(MediaType.IMAGE_PNG);
        assertThat(ImageUrlPolicy.imageContentType(null, URI.create("https://x.com/a.JPG!w100")))
            .isEqualTo(MediaType.IMAGE_JPEG);
        assertThat(ImageUrlPolicy.imageContentType(null, URI.create("https://x.com/a.webp")).toString())
            .isEqualTo("image/webp");
        assertThat(ImageUrlPolicy.imageContentType(MediaType.TEXT_HTML, URI.create("https://x.com/a.html"))).isNull();
    }
}
