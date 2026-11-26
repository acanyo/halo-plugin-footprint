package cc.lik.footprint.service.impl;

/**
 * 高德返回 HTTP 成功但 JSON 业务状态失败。
 */
final class GaodeApiException extends RuntimeException {

    enum Kind {
        RATE_LIMIT,
        DAILY_LIMIT,
        INVALID_KEY,
        OTHER
    }

    private final String code;
    private final Kind kind;

    private GaodeApiException(String code, String message) {
        super(message);
        this.code = code;
        this.kind = classify(code);
    }

    static GaodeApiException from(String code, String message) {
        String normalizedCode = code == null ? "" : code.trim();
        String normalizedMessage = message == null || message.isBlank()
            ? normalizedCode
            : message.trim();
        return new GaodeApiException(normalizedCode, normalizedMessage);
    }

    String getCode() {
        return code;
    }

    Kind getKind() {
        return kind;
    }

    boolean isRateLimit() {
        return kind == Kind.RATE_LIMIT;
    }

    boolean isGlobalFailure() {
        return kind != Kind.OTHER;
    }

    private static Kind classify(String code) {
        String normalized = code == null ? "" : code.toUpperCase();
        if (normalized.contains("QPS")) {
            return Kind.RATE_LIMIT;
        }
        if (normalized.contains("DAILY") && normalized.contains("LIMIT")) {
            return Kind.DAILY_LIMIT;
        }
        if (normalized.contains("INVALID_USER_KEY")
            || normalized.contains("USER_KEY_RECYCLED")) {
            return Kind.INVALID_KEY;
        }
        return Kind.OTHER;
    }
}
