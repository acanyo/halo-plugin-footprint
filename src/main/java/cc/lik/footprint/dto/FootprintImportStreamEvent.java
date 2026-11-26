package cc.lik.footprint.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 批量导入地址解析的流式事件，每行一个 NDJSON 记录。
 */
@Data
@Builder
public class FootprintImportStreamEvent {

    /**
     * start / row / complete / error。
     */
    private String type;

    private Integer total;

    private FootprintImportRow item;

    private String message;
}
