package cc.lik.footprint.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * 批量导入结果。dryRun 时 success 为 0，ready 表示可以写入的行数。
 */
@Data
@Builder
@Schema(name = "FootprintImportResult")
public class FootprintImportResult {

    private long total;

    private long ready;

    private long success;

    private long failed;

    private long skipped;

    private boolean dryRun;

    private List<FootprintImportRow> items;
}
