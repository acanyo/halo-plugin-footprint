package cc.lik.footprint.service.impl;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/**
 * 批量导入中的纯函数，便于独立测试日期和重复判定口径。
 */
final class FootprintImportSupport {

    private static final DateTimeFormatter LOCAL_DATE_TIME =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm[:ss]", Locale.ROOT);

    private FootprintImportSupport() {
    }

    static Instant parseVisitTime(String raw, ZoneId zoneId) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("访问时间不能为空");
        }
        try {
            if (value.endsWith("Z")) {
                return Instant.parse(value);
            }
            if (value.matches(".*[+-]\\d{2}:?\\d{2}$")) {
                return OffsetDateTime.parse(value).toInstant();
            }
            return LocalDateTime.parse(value, LOCAL_DATE_TIME)
                .atZone(zoneId)
                .toInstant();
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(
                "访问时间格式不正确，应为 yyyy-MM-ddTHH:mm[:ss]"
            );
        }
    }

    static String duplicateKey(String name, String address, Instant visitTime) {
        return normalize(name) + "\u0000" + normalize(address) + "\u0000"
            + visitTime.toEpochMilli();
    }

    static double[] parseLocation(String location) {
        String[] parts = location == null ? new String[0] : location.trim().split(",");
        if (parts.length != 2) {
            throw new IllegalArgumentException("地址解析结果格式不正确");
        }
        try {
            return new double[] {Double.parseDouble(parts[0]), Double.parseDouble(parts[1])};
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("地址解析结果不是有效经纬度");
        }
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }
}
