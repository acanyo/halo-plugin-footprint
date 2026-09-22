package cc.lik.footprint;

import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.service.FootprintService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import run.halo.app.theme.TemplateNameResolver;
import run.halo.app.theme.router.ModelConst;
import run.halo.app.plugin.ReactiveSettingFetcher;
import run.halo.app.extension.ReactiveExtensionClient;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.net.URI;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Comparator;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;
import static org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR;

@Slf4j
@Configuration
@AllArgsConstructor
public class FootprintRouter {

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

    private final TemplateNameResolver templateNameResolver;
    private final ReactiveExtensionClient client;
    private final FootprintService footprintSvc;

    /**
     * 允许代理的图片域名缓存：省掉每张图都去列一遍足迹。
     * 注意这里必须是 static —— 本类用 @AllArgsConstructor，Lombok 会把所有非静态字段都当构造参数，
     * 写成实例字段会变成「Spring 去注入 long / Set 类型的 Bean」而启动失败。
     */
    private static final long IMAGE_HOSTS_TTL_MS = 5L * 60 * 1000;
    private static final Pattern URL_HOST_PATTERN =
        Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)");
    private static volatile Set<String> cachedImageHosts = Set.of();
    private static volatile long imageHostsExpireAt = 0L;

    @Bean
    RouterFunction<ServerResponse> footprintRouterFunction() {
        return route(GET("/footprints"), this::renderFootprintPage)
            .andRoute(GET("/footprints/image-proxy"), this::proxyTicketImage);
    }

    /**
     * 票根图代理。
     * 票根图可能来自另一个域名（图床 / CDN，本地开发时也常见），跨域图片既会被 CORS 拦掉，
     * 画进 canvas 之后也无法导出（toBlob 抛 SecurityError），写信与明信片功能就废了。
     * 这里用插件自己的域名取一次，浏览器拿到的是同源图片。
     */
    private Mono<ServerResponse> proxyTicketImage(ServerRequest request) {
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
        if (isBlockedHost(normalizedHost)) {
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

    private void collectHost(Set<String> hosts, String value) {
        String host = hostOf(value);
        if (host != null) {
            hosts.add(host.toLowerCase(Locale.ROOT));
        }
    }

    private String hostOf(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        try {
            URI uri = URI.create(trimmed);
            if (uri.getHost() != null) {
                return uri.getHost();
            }
        } catch (IllegalArgumentException ignored) {
            /* URL 里可能有未编码的中文或空格，退回正则取域名 */
        }
        Matcher matcher = URL_HOST_PATTERN.matcher(trimmed);
        return matcher.find() ? matcher.group(1) : null;
    }

    private boolean isBlockedHost(String host) {
        if (host.equals("localhost") || host.endsWith(".localhost")
            || host.equals("::1") || host.equals("[::1]")) {
            return true;
        }
        String[] parts = host.split("\\.");
        if (parts.length != 4) {
            return false;
        }
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            if (a == 0 || a == 10 || a == 127) {
                return true;
            }
            if (a == 172 && b >= 16 && b <= 31) {
                return true;
            }
            if (a == 192 && b == 168) {
                return true;
            }
            return a == 169 && b == 254;
        } catch (NumberFormatException e) {
            return false;
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
                MediaType contentType = imageContentType(response.headers().contentType().orElse(null), uri);
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

    /**
     * 决定回给浏览器的图片类型，拿不到就返回 null（调用方按 415 处理）。
     * 远端不一定给对类型：Halo 的缩略图地址带 !w100 这类后缀，远端常常只给
     * application/octet-stream，这种类型加上 nosniff 后 &lt;img&gt; 是不会渲染的，
     * 所以这里再按（去掉 !后缀 的）扩展名兜一次。
     */
    private MediaType imageContentType(MediaType fromHeader, URI uri) {
        if (fromHeader != null && "image".equalsIgnoreCase(fromHeader.getType())) {
            return fromHeader;
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        int suffix = path.indexOf('!');
        if (suffix >= 0) {
            path = path.substring(0, suffix);
        }
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) {
            return MediaType.IMAGE_PNG;
        }
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
            return MediaType.IMAGE_JPEG;
        }
        if (lower.endsWith(".gif")) {
            return MediaType.IMAGE_GIF;
        }
        if (lower.endsWith(".webp")) {
            return MediaType.parseMediaType("image/webp");
        }
        if (lower.endsWith(".avif")) {
            return MediaType.parseMediaType("image/avif");
        }
        if (lower.endsWith(".bmp")) {
            return MediaType.parseMediaType("image/bmp");
        }
        if (lower.endsWith(".svg")) {
            return MediaType.parseMediaType("image/svg+xml");
        }
        return null;
    }

    private Mono<ServerResponse> renderFootprintPage(ServerRequest request) {
        log.info("开始渲染足迹页面");
        return footprintSvc.getConfigByGroupName()
            .flatMap(settings -> {
                log.info("已加载足迹页面配置");
                // 按创建时间倒序排序
                Comparator<Footprint> comparator = 
                    (f1, f2) -> f2.getSpec().getCreateTime()
                        .compareTo(f1.getSpec().getCreateTime());

                return client.list(Footprint.class,
                        null,
                        comparator,
                        0,
                        1000) // 获取所有足迹
                    .flatMap(footprints -> {
                        log.info("获取到足迹数据: {} 条", footprints.getItems().size());
                        Map<String, Object> model = new HashMap<>();
                        model.put("settings", settings);
                        model.put("footprints", footprints.getItems());
                        // 给 Head 处理器等渲染扩展一个稳定的页面标识（Halo 约定）：
                        // FootprintHeadProcessor 靠它判断"这是足迹页"，才注入 3D 地球那套资源。
                        model.put(ModelConst.TEMPLATE_ID, "plugin:footprint:footprints");

                        return templateNameResolver.resolveTemplateNameOrDefault(
                                request.exchange(), 
                                "footprint"
                            )
                            .flatMap(templateName -> {
                                log.info("使用模板: {}", templateName);
                                return ServerResponse.ok()
                                    .render(templateName, model);
                            });
                    });
            })
            .onErrorResume(e -> {
                log.error("渲染足迹页面失败", e);
                return ServerResponse.status(INTERNAL_SERVER_ERROR)
                    .bodyValue("渲染足迹页面失败: " + e.getMessage());
            });
    }
}
