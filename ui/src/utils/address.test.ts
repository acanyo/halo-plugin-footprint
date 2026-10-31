import { describe, expect, it } from "vitest";
import { addressFromCity } from "./address";

describe("addressFromCity", () => {
  it("从城市名开始保留地址", () => {
    expect(
      addressFromCity(
        "浙江省杭州市西湖区西溪街道沈塘新村邮电新村",
        "杭州市",
        "浙江省",
      ),
    ).toBe("杭州市西湖区西溪街道沈塘新村邮电新村");
  });

  it("兼容城市名省略行政区后缀", () => {
    expect(addressFromCity("浙江省湖州市吴兴区", "湖州", "浙江省"))
      .toBe("湖州市吴兴区");
  });

  it("直辖市仍从城市名开始", () => {
    expect(addressFromCity("北京市朝阳区建国路", "北京市", "北京市"))
      .toBe("北京市朝阳区建国路");
  });

  it("找不到城市时去掉省份前缀", () => {
    expect(addressFromCity("浙江省某地", "", "浙江省")).toBe("某地");
  });

  it("没有可截取信息时保留原地址", () => {
    expect(addressFromCity("人民路 1 号", "杭州市", "浙江省"))
      .toBe("人民路 1 号");
  });
});
