import { describe, expect, it } from "vitest";
import {
  autoMapColumns,
  buildImportRows,
  parseCsvTable,
  parseLocalVisitTime,
  recordsFromJson,
  recordsFromTable,
  validateImportRow,
} from "@/utils/footprint-import";

describe("parseCsvTable", () => {
  it("支持 BOM、引号、逗号和字段内换行", () => {
    const rows = parseCsvTable('\uFEFF地点名称,地址,描述\r\n西湖,"杭州,浙江","第一行\n第二行"\r\n');
    expect(rows).toEqual([
      ["地点名称", "地址", "描述"],
      ["西湖", "杭州,浙江", "第一行\n第二行"],
    ]);
  });
});

describe("recordsFromTable", () => {
  it("首行作为列名并保留真实表格行号", () => {
    const result = recordsFromTable([
      ["地点名称", "地址", "描述"],
      ["西湖", "杭州市西湖区", "第一次去"],
    ]);
    expect(result.columns).toEqual(["地点名称", "地址", "描述"]);
    expect(result.records[0].rowNumber).toBe(1);
    expect(result.records[0].values["地点名称"]).toBe("西湖");
  });

  it("忽略旧模板中的缩放级别列", () => {
    const result = recordsFromTable([
      ["地点名称", "地址", "描述", "日期", "时间", "缩放级别"],
      ["西湖", "杭州市西湖区", "春天", "2024-05-01", "", "20"],
    ]);
    expect(result.columns).not.toContain("缩放级别");
    expect(result.records[0].values).not.toHaveProperty("缩放级别");
  });
});

describe("recordsFromJson", () => {
  it("支持数组和嵌套字段", () => {
    const result = recordsFromJson(
      '[{"spec":{"name":"西湖"},"address":"杭州","description":"春天"}]',
    );
    expect(result.columns).toContain("spec.name");
    expect(result.records[0].values["address"]).toBe("杭州");
  });

  it("忽略 JSON 中的缩放级别字段", () => {
    const result = recordsFromJson(
      '[{"name":"西湖","address":"杭州","description":"春天","zoomLevel":"18"}]',
    );
    expect(result.columns).not.toContain("zoomLevel");
    expect(result.records[0].values).not.toHaveProperty("zoomLevel");
  });
});

describe("字段映射与数据构造", () => {
  it("自动识别中文表头", () => {
    expect(autoMapColumns(["地点名称", "详细地址", "描述", "日期", "时间"])).toEqual({
      name: "地点名称",
      address: "详细地址",
      description: "描述",
      date: "日期",
      time: "时间",
    });
  });

  it("自动识别带必填星号和隐藏文本前缀的模板", () => {
    const columns = ["地点名称 *", "地址 *", "描述 *", "日期 *", "时间"];
    const mapping = autoMapColumns(columns);

    expect(mapping).toEqual({
      name: "地点名称 *",
      address: "地址 *",
      description: "描述 *",
      date: "日期 *",
      time: "时间",
    });

    const rows = buildImportRows(
      [
        {
          rowNumber: 1,
          values: {
            "地点名称 *": "西湖",
            "地址 *": "杭州市西湖区",
            "描述 *": "春天",
            "日期 *": "\u200B2024-05-01",
            时间: "",
          },
        },
      ],
      mapping,
      "旅游",
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].visitTime).toBe(new Date(2024, 4, 1, 0, 0, 0).toISOString());
  });

  it("日期无时间时补 00:00，缩放固定为 14", () => {
    const rows = buildImportRows(
      [
        {
          rowNumber: 2,
          values: {
            地点名称: "西湖",
            地址: "杭州市西湖区",
            描述: "春天",
            日期: "2024-05-01",
          },
        },
      ],
      {
        name: "地点名称",
        address: "地址",
        description: "描述",
        date: "日期",
        time: "时间",
      },
      "旅游",
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].visitTime).toBe(new Date(2024, 4, 1, 0, 0, 0).toISOString());
    expect(rows[0].zoomLevel).toBe("14");
    expect(rows[0].footprintType).toBe("旅游");
  });

  it("必填项会被标记", () => {
    const rows = buildImportRows(
      [{ rowNumber: 3, values: { 日期: "2024-05-01" } }],
      {
        name: "地点",
        address: "地址",
        description: "描述",
        date: "日期",
        time: "时间",
      },
      "旅游",
    );
    expect(rows[0].errors).toContain("地点名称不能为空");
    expect(rows[0].errors).toContain("描述不能为空");
    expect(rows[0].errors).toContain("地址不能为空");
  });
});

describe("parseLocalVisitTime", () => {
  it("单独时间覆盖日期中已有的时间", () => {
    const result = parseLocalVisitTime("2024-05-01 08:00", "17:30");
    expect(result).toEqual({
      ok: true,
      value: new Date(2024, 4, 1, 17, 30, 0).toISOString(),
    });
  });

  it("支持 Excel 的时间单元格", () => {
    const excelTime = new Date(1899, 11, 30, 9, 45, 30);
    const result = parseLocalVisitTime("2024-05-01", excelTime);
    expect(result).toEqual({
      ok: true,
      value: new Date(2024, 4, 1, 9, 45, 30).toISOString(),
    });
  });

  it("非法日期被拒绝", () => {
    const result = parseLocalVisitTime("2024-02-31", "");
    expect(result.ok).toBe(false);
  });
});

describe("validateImportRow", () => {
  it("行内修改后可以重新校验必填字段", () => {
    const errors = validateImportRow({
      name: "地点",
      address: "地址",
      description: "",
      visitTime: new Date(2024, 4, 1).toISOString(),
      footprintType: "旅游",
    });
    expect(errors).toContain("描述不能为空");
  });

  it("足迹类型必填", () => {
    const errors = validateImportRow({
      name: "西湖",
      address: "杭州市西湖区",
      description: "春天",
      visitTime: new Date(2024, 4, 1).toISOString(),
      footprintType: "",
    });
    expect(errors).toContain("请选择足迹类型");
  });
});
