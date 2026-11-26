package cc.lik.footprint.stats;

import cc.lik.footprint.model.Footprint;

import java.util.List;

/**
 * 后台足迹整理状态筛选。
 */
public final class FootprintOrganizeFilter {

    public static final String MISSING_PHOTO = "missingPhoto";
    public static final String MISSING_TICKET = "missingTicket";
    public static final String NEEDS_ATTENTION = "needsAttention";

    private FootprintOrganizeFilter() {
    }

    public static boolean matches(Footprint footprint, String status) {
        if (status == null || status.isBlank()) {
            return true;
        }
        if (footprint == null || footprint.getSpec() == null) {
            return NEEDS_ATTENTION.equals(status);
        }
        Footprint.FootprintSpec spec = footprint.getSpec();
        boolean missingPhoto = !hasPhoto(spec);
        boolean missingTicket = isBlank(spec.getTicketImage());
        return switch (status) {
            case MISSING_PHOTO -> missingPhoto;
            case MISSING_TICKET -> missingTicket;
            case NEEDS_ATTENTION -> missingPhoto || missingTicket;
            default -> true;
        };
    }

    private static boolean hasPhoto(Footprint.FootprintSpec spec) {
        if (!isBlank(spec.getImage())) {
            return true;
        }
        List<Footprint.GalleryImage> images = spec.getGalleryImages();
        return images != null && images.stream().anyMatch(image ->
            image != null && !isBlank(image.getUrl())
        );
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
