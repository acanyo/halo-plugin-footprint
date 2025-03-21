package cc.lik.footprint.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class BaseConfig {
    private String title;
    private String gaoDeKey;
    private String describe;
    private String hsla;
    private String logoName;
    private String mapStyle;
}

