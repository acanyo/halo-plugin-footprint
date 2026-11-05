/**
 * 将高德返回的完整地址压缩成从市级开始的地址。
 *
 * 优先从 city 在完整地址中的位置截取；城市写法可能省略“市”等后缀，
 * 因此再做一次去掉行政区后缀的兼容匹配。找不到城市时，至少尝试去掉省份前缀。
 */
export function addressFromCity(
  fullAddress: unknown,
  city?: unknown,
  province?: unknown,
): string {
  const address = String(fullAddress ?? "").trim();
  if (!address) return "";

  const cityText = String(city ?? "").trim();
  if (cityText) {
    const exactIndex = address.indexOf(cityText);
    if (exactIndex >= 0) return address.slice(exactIndex).trim();

    const cityBase = cityText.replace(/(特别行政区|自治州|地区|盟|市|县)$/u, "");
    if (cityBase && cityBase !== cityText) {
      const baseIndex = address.indexOf(cityBase);
      if (baseIndex >= 0) return address.slice(baseIndex).trim();
    }
  }

  const provinceText = String(province ?? "").trim();
  if (provinceText && address.startsWith(provinceText)) {
    return address.slice(provinceText.length).trim();
  }
  return address;
}
