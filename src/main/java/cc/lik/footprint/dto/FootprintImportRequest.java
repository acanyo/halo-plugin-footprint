package cc.lik.footprint.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 批量导入请求。
 */
@Data
@Schema(name = "FootprintImportRequest")
public class FootprintImportRequest {

    private List<FootprintImportRow> rows;

    /**
     * 本批足迹统一使用的类型；留空表示导入后待整理。
     */
    private String footprintType;
}
