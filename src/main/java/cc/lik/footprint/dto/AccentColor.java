package cc.lik.footprint.dto;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 后台「主题色」的取值统一成 {@code #rrggbb}。
 *
 * <p>3.0 之前这一项是文本框，填的是 {@code h,s%,l%} 三元组（例如 {@code 322,68%,60%}）；
 * 现在换成 Halo 的取色组件，存的是 {@code #rrggbb}。已经保存的旧值不做迁移，
 * 读配置时在这里换算，前台只认 hex。认不出来的值回落到默认淡紫。</p>
 *
 * <p>前台 {@code shared/accent.js} 也有一份同样的换算，用来兜住旧缓存页面；
 * 两边算法一致（都是标准 HSL → RGB，四舍五入到整数）。</p>
 */
public final class AccentColor {

    public static final String DEFAULT = "#7c7bc0";

    private static final Pattern HEX = Pattern.compile("^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$");
    private static final Pattern HSL = Pattern.compile(
        "^(?:hsla?\\(\\s*)?(-?[\\d.]+)(?:deg)?\\s*,\\s*([\\d.]+)%\\s*,\\s*([\\d.]+)%\\s*\\)?$",
        Pattern.CASE_INSENSITIVE);

    private AccentColor() {
    }

    /**
     * 把设置里的任意写法换成 {@code #rrggbb}（小写）。
     *
     * @param value 新的 hex 值、旧的 hsl 三元组，或空
     */
    public static String normalize(String value) {
        if (value == null) {
            return DEFAULT;
        }
        String raw = value.trim();
        Matcher hex = HEX.matcher(raw);
        if (hex.matches()) {
            String digits = hex.group(1).toLowerCase(Locale.ROOT);
            if (digits.length() == 3) {
                digits = "" + digits.charAt(0) + digits.charAt(0)
                    + digits.charAt(1) + digits.charAt(1)
                    + digits.charAt(2) + digits.charAt(2);
            }
            return "#" + digits;
        }
        Matcher hsl = HSL.matcher(raw);
        if (hsl.matches()) {
            try {
                return fromHsl(Double.parseDouble(hsl.group(1)),
                    Double.parseDouble(hsl.group(2)),
                    Double.parseDouble(hsl.group(3)));
            } catch (NumberFormatException e) {
                return DEFAULT;
            }
        }
        return DEFAULT;
    }

    private static String fromHsl(double hue, double saturation, double lightness) {
        double h = (((hue % 360) + 360) % 360) / 360;
        double s = Math.min(100, saturation) / 100;
        double l = Math.min(100, lightness) / 100;
        if (s == 0) {
            int v = (int) Math.round(l * 255);
            return toHex(v, v, v);
        }
        double q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        double p = 2 * l - q;
        return toHex(
            (int) Math.round(hueToChannel(p, q, h + 1.0 / 3) * 255),
            (int) Math.round(hueToChannel(p, q, h) * 255),
            (int) Math.round(hueToChannel(p, q, h - 1.0 / 3) * 255));
    }

    private static double hueToChannel(double p, double q, double t) {
        if (t < 0) {
            t += 1;
        }
        if (t > 1) {
            t -= 1;
        }
        if (t < 1.0 / 6) {
            return p + (q - p) * 6 * t;
        }
        if (t < 1.0 / 2) {
            return q;
        }
        if (t < 2.0 / 3) {
            return p + (q - p) * (2.0 / 3 - t) * 6;
        }
        return p;
    }

    private static String toHex(int r, int g, int b) {
        return String.format(Locale.ROOT, "#%02x%02x%02x", r, g, b);
    }
}
