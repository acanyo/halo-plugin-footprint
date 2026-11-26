package cc.lik.footprint.service;

import cc.lik.footprint.dto.FootprintImportRequest;
import cc.lik.footprint.dto.FootprintImportResult;
import cc.lik.footprint.dto.FootprintImportStreamEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 批量导入足迹。
 */
public interface FootprintImportService {

    /**
     * @param request 导入数据
     * @param dryRun  true 时只校验和解析地址，不写入数据库
     */
    Mono<FootprintImportResult> importFootprints(FootprintImportRequest request, boolean dryRun);

    /**
     * 流式预览：每完成一行立即推送，客户端断开时停止后续解析。
     */
    Flux<FootprintImportStreamEvent> streamPreview(FootprintImportRequest request);
}
