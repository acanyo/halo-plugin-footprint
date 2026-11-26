package cc.lik.footprint.stats;

import cc.lik.footprint.model.Footprint;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FootprintOrganizeFilterTest {

    @Test
    @DisplayName("可分别筛选照片和票根缺失")
    void filtersMissingFieldsSeparately() {
        Footprint footprint = footprint("", "", "");

        assertThat(FootprintOrganizeFilter.matches(
            footprint,
            FootprintOrganizeFilter.MISSING_PHOTO
        )).isTrue();
        assertThat(FootprintOrganizeFilter.matches(
            footprint,
            FootprintOrganizeFilter.MISSING_TICKET
        )).isTrue();
    }

    @Test
    @DisplayName("封面或图片墙任一存在就不算缺照片")
    void coverOrGalleryCountsAsPhoto() {
        Footprint cover = footprint("旅游", "cover.jpg", "");
        Footprint gallery = footprint("旅游", "", "");
        Footprint.GalleryImage image = new Footprint.GalleryImage();
        image.setUrl("gallery.jpg");
        gallery.getSpec().setGalleryImages(List.of(image));

        assertThat(FootprintOrganizeFilter.matches(
            cover,
            FootprintOrganizeFilter.MISSING_PHOTO
        )).isFalse();
        assertThat(FootprintOrganizeFilter.matches(
            gallery,
            FootprintOrganizeFilter.MISSING_PHOTO
        )).isFalse();
    }

    @Test
    @DisplayName("待整理匹配任一缺失状态")
    void needsAttentionMatchesAnyMissingField() {
        Footprint onlyTicketMissing = footprint("旅游", "cover.jpg", "");
        Footprint complete = footprint("旅游", "cover.jpg", "ticket.jpg");

        assertThat(FootprintOrganizeFilter.matches(
            onlyTicketMissing,
            FootprintOrganizeFilter.NEEDS_ATTENTION
        )).isTrue();
        assertThat(FootprintOrganizeFilter.matches(
            complete,
            FootprintOrganizeFilter.NEEDS_ATTENTION
        )).isFalse();
    }

    private Footprint footprint(String type, String cover, String ticket) {
        Footprint footprint = new Footprint();
        Footprint.FootprintSpec spec = new Footprint.FootprintSpec();
        spec.setFootprintType(type);
        spec.setImage(cover);
        spec.setTicketImage(ticket);
        footprint.setSpec(spec);
        return footprint;
    }
}
