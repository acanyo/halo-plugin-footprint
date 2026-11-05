package cc.lik.footprint.model;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class FootprintWishTest {

    @Test
    void plannedMonthRequiresYear() {
        FootprintWish.Spec spec = new FootprintWish.Spec();
        spec.setPlannedMonth(5);
        assertFalse(spec.isPlannedMonthValid());

        spec.setPlannedYear(2027);
        assertTrue(spec.isPlannedMonthValid());
    }

    @Test
    void emptyMonthIsAllowed() {
        FootprintWish.Spec spec = new FootprintWish.Spec();
        assertTrue(spec.isPlannedMonthValid());
        spec.setPlannedYear(2027);
        assertTrue(spec.isPlannedMonthValid());
    }
}
