package cc.lik.footprint.dto;

import cc.lik.footprint.model.FootprintGroup;
import java.util.List;
import lombok.Data;

/** 旅途集列表使用的轻量摘要，避免后台为每张卡片重复遍历全部足迹。 */
@Data
public class FootprintGroupSummaryDto {
    private FootprintGroup group;
    private int memberCount;
    private int missingCount;
    private int cityCount;
    private int provinceCount;
    private List<String> searchTerms;
    private int days;
    private String rangeStart;
    private String rangeEnd;
    private String cover;
}
