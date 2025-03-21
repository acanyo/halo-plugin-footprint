package cc.lik.footprint.vo;

import cc.lik.footprint.model.Footprint;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import lombok.experimental.SuperBuilder;
import run.halo.app.extension.MetadataOperator;


@Data
@SuperBuilder
@ToString
@EqualsAndHashCode
public class FootprintVo {

    private MetadataOperator metadata;

    private Footprint.FootprintSpec spec;

    public static FootprintVo from(Footprint footprint) {
        return FootprintVo.builder()
            .metadata(footprint.getMetadata())
            .spec(footprint.getSpec())
            .build();
    }
}
