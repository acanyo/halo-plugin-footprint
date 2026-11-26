package cc.lik.footprint.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 批量导入中的一行足迹。
 *
 * <p>前端完成文件解析后提交本对象；状态和提示字段只在接口响应中使用。</p>
 */
@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
@Schema(name = "FootprintImportRow")
public class FootprintImportRow {

    private Integer rowNumber;

    private String name;

    private String address;

    private String description;

    /**
     * ISO 8601 日期时间；也兼容不带时区的本地日期时间。
     */
    private String visitTime;

    private String zoomLevel;

    private String footprintType;

    private Double longitude;

    private Double latitude;

    private String province;

    private String city;

    private String provinceAdcode;

    private String cityAdcode;

    /**
     * valid / duplicate / invalid / success / failed。
     */
    private String status;

    private String message;
}
