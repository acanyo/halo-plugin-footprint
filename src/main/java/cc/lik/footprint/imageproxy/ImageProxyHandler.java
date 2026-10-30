package cc.lik.footprint.imageproxy;

import cc.lik.footprint.model.Footprint;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import run.halo.app.extension.ReactiveExtensionClient;

import java.net.URI;
import java.time.Duration;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 票根图代理。
 * 票根图可能来自另一个域名（图床 / CDN，本地开发时也常见），跨域图片既会被 CORS 拦掉，
 * 画进 canvas 之后也无法导出（toBlob 抛 SecurityError），写信与明信片功能就废了。
 * 这里用插件自己的域名取一次，浏览器拿到的是同源图片。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImageProxyHandler {

    /** 代理下载的图片上限，超过就截断（正常情况下票根图远小于这个值） */
    private static final long IMAGE_MAX_BYTES = 10L * 1024 * 1024;

    private static final WebClient IMAGE_CLIENT = WebClient.builder()
        .defaultHeader(HttpHeaders.USER_AGENT, "HaloFootprintPlugin/1.0 (image-proxy)")
        .defaultHeader(HttpHeaders.ACCEPT, "image/*,*/*;q=0.8")
        // 图床常见 http → https 跳转，必须跟着走，否则代理拿到的只是 302
        .clientConnector(new ReactorClientHttpConnector(HttpClient.create().followRedirect(true)))
        // 图片上限 10MB，这里把编解码器上限放到 12MB，整张读进内存再回给浏览器：
        // 早先用流式转发，DataBuffer 在 ServerResponse 真正写出前已被释放，浏览器拿到的是空 body
        .codecs(config -> config.defaultCodecs().maxInMemorySize(12 * 1024 * 1024))
        .build();

    /** 允许代理的图片域名缓存：省掉每张图都去列一遍足迹 */
    private static final long IMAGE_HOSTS_TTL_MS = 5L * 60 * 1000;

    private final ReactiveExtensionClient client;

    private volatile Set<String> cachedImageHosts = Set.of();
    private volatile long imageHostsExpireAt = 0L;

    public Mono<ServerResponse> handle(ServerRequest request) {
        String raw = request.queryParam("url").orElse("").trim();
        URI uri;
        try {
            uri = URI.create(raw);
        } catch (IllegalArgumentException e) {
            return ServerResponse.badRequest().bodyValue("图片地址不合法");
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null
            || !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
            return ServerResponse.badRequest().bodyValue("只支持 http / https 图片地址");
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        if (ImageUrlPolicy.isBlockedHost(normalizedHost)) {
            return ServerResponse.status(HttpStatus.FORBIDDEN).bodyValue("不允许代理该地址");
        }
        // 只允许代理「本站足迹里出现过的图片域名」，避免这个接口被当成任意代理使用
        return allowedImageHosts()
            .flatMap(hosts -> hosts.contains(normalizedHost)
                ? fetchImage(uri)
                : ServerResponse.status(HttpStatus.FORBIDDEN)
                    .bodyValue("只允许代理本站票根里出现过的图片"));
    }

    private Mono<Set<String>> allowedImageHosts() {
        long now = System.currentTimeMillis();
        Set<String> cached = cachedImageHosts;
        if (!cached.isEmpty() && now < imageHostsExpireAt) {
            return Mono.just(cached);
        }
        return client.list(Footprint.class, null, null, 0, 1000)
            .map(list -> {
                Set<String> hosts = new HashSet<>();
                list.getItems().forEach(footprint -> {
                    var spec = footprint.getSpec();
                    collectHost(hosts, spec.getTicketImage());
                    collectHost(hosts, spec.getImage());
                    if (spec.getGalleryImages() != null) {
                        spec.getGalleryImages().forEach(image -> collectHost(hosts, image.getUrl()));
                    }
                });
                return hosts;
            })
            .doOnNext(hosts -> {
                cachedImageHosts = hosts;
                imageHostsExpireAt = System.currentTimeMillis() + IMAGE_HOSTS_TTL_MS;
            });
    }

    private static void collectHost(Set<String> hosts, String value) {
        String host = ImageUrlPolicy.hostOf(value);
        if (host != null) {
            hosts.add(host.toLowerCase(Locale.ROOT));
        }
    }

    private Mono<ServerResponse> fetchImage(URI uri) {
        return IMAGE_CLIENT.get()
            .uri(uri)
            .exchangeToMono(response -> {
                if (!response.statusCode().is2xxSuccessful()) {
                    return ServerResponse.status(HttpStatus.BAD_GATEWAY)
                        .bodyValue("远端图片返回 " + response.statusCode().value());
                }
                MediaType contentType = ImageUrlPolicy.imageContentType(
                    response.headers().contentType().orElse(null), uri);
                if (contentType == null) {
                    return ServerResponse.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                        .bodyValue("远端返回的不是图片");
                }
                if (log.isDebugEnabled()) {
                    log.debug("代理票根图片 {} -> {}", uri, contentType);
                }
                return response.bodyToMono(byte[].class).flatMap(bytes -> {
                    if (bytes.length > IMAGE_MAX_BYTES) {
                        return ServerResponse.status(HttpStatus.PAYLOAD_TOO_LARGE)
                            .bodyValue("图片超过 10MB");
                    }
                    return ServerResponse.ok()
                        .contentType(contentType)
                        .header(HttpHeaders.CACHE_CONTROL, "public, max-age=86400")
                        .header("X-Content-Type-Options", "nosniff")
                        .bodyValue(bytes);
                });
            })
            .timeout(Duration.ofSeconds(15))
            .onErrorResume(e -> {
                log.warn("代理票根图片失败: {} ({})", uri, e.getMessage());
                return ServerResponse.status(HttpStatus.BAD_GATEWAY).bodyValue("代理图片失败");
            });
    }
}
