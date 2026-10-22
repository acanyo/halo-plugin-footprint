import { describe, expect, it } from "vitest";
import type { ProvinceStat } from "@/api/models";
import {
  TOTAL_PROVINCES,
  coverageRate,
  provinceCategoryStats,
  provinceCoverageRate,
} from "@/utils/province-coverage";

function province(name: string, adcode: string, count = 1): ProvinceStat {
  return { name, adcode, count, cities: [] };
}

describe("coverageRate", () => {
  it("按 visited/total 折算成整数百分比", () => {
    expect(coverageRate(1, 4)).toBe(25);
    expect(coverageRate(3, 34)).toBe(9);
  });

  it("总数不足一半时向下取整而不是四舍五入到 100", () => {
    expect(coverageRate(33, 34)).toBe(97);
    expect(coverageRate(34, 34)).toBe(100);
  });

  it("分母为 0 时返回 0，不产生 NaN", () => {
    expect(coverageRate(0, 0)).toBe(0);
    expect(coverageRate(5, 0)).toBe(0);
  });
});

describe("provinceCoverageRate", () => {
  it("以全国 34 个省级行政区为分母", () => {
    expect(TOTAL_PROVINCES).toBe(34);
    expect(provinceCoverageRate(0)).toBe(0);
    expect(provinceCoverageRate(17)).toBe(50);
    expect(provinceCoverageRate(34)).toBe(100);
  });

  it("数据异常导致超过 34 时仍封顶 100", () => {
    expect(provinceCoverageRate(40)).toBe(100);
  });
});

describe("provinceCategoryStats", () => {
  it("四类数量相加等于 34", () => {
    const total = provinceCategoryStats([]).reduce((sum, c) => sum + c.total, 0);
    expect(total).toBe(TOTAL_PROVINCES);
  });

  it("空数据时各类已到访数都是 0", () => {
    expect(provinceCategoryStats([]).every((c) => c.visited === 0)).toBe(true);
  });

  it("按 adcode 前两位归类", () => {
    const result = provinceCategoryStats([
      province("北京", "110000"),
      province("上海", "310000"),
      province("内蒙古", "150000"),
      province("香港", "810000"),
      province("广东", "440000"),
      province("浙江", "330000"),
    ]);
    const byKey = Object.fromEntries(result.map((c) => [c.key, c.visited]));
    expect(byKey).toEqual({ municipality: 2, autonomous: 1, sar: 1, province: 2 });
  });

  it("adcode 缺失或无法识别时归入省份兜底", () => {
    const result = provinceCategoryStats([province("未知", ""), province("某地", "990000")]);
    const provinceCategory = result.find((c) => c.key === "province");
    expect(provinceCategory?.visited).toBe(2);
  });

  it("同一 adcode 重复出现只算一次，避免覆盖率超过 100%", () => {
    const result = provinceCategoryStats([
      province("北京", "110000", 3),
      province("北京", "110000", 2),
    ]);
    const municipality = result.find((c) => c.key === "municipality");
    expect(municipality?.visited).toBe(1);
  });
});
