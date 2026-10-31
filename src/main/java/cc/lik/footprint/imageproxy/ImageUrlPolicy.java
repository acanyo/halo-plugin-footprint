package cc.lik.footprint.imageproxy;

import org.springframework.http.MediaType;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 票根图代理的 URL 判定规则：域名提取、内网地址拦截、图片类型兜底。
 * 全是纯函数，不碰网络，单独拎出来便于单测。
 */
public final class ImageUrlPolicy {

    private static final Pattern URL_HOST_PATTERN =
        Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)");

    private ImageUrlPolicy() {
    }

    /** 取 URL 的域名（小写前的原样），取不到返回 null */
    public static String hostOf(String value) {
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

    /** 本机与内网地址一律不代理，避免被当成 SSRF 跳板 */
    public static boolean isBlockedHost(String host) {
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

    /**
     * 决定回给浏览器的图片类型，拿不到就返回 null（调用方按 415 处理）。
     * 远端不一定给对类型：Halo 的缩略图地址带 !w100 这类后缀，远端常常只给
     * application/octet-stream，这种类型加上 nosniff 后 &lt;img&gt; 是不会渲染的，
     * 所以这里再按（去掉 !后缀 的）扩展名兜一次。
     */
    public static MediaType imageContentType(MediaType fromHeader, URI uri) {
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
}
