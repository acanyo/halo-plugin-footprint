/**
 * 经纬度手动输入的解析与校验。
 *
 * 足迹的经纬度有两处手动输入入口，用途并不相同：
 * - 编辑弹窗：地址无法地理编码时弹出，填完写入表单并继续保存；
 * - 足迹管理列表：对已保存的足迹做事后修正，直接调用更新接口。
 *
 * 入口不同但「怎样算合法坐标」必须一致，因此把这段判断收敛到这里，
 * 避免两处各写一遍后逐渐漂移。
 */

export const LONGITUDE_RANGE = [-180, 180] as const;
export const LATITUDE_RANGE = [-90, 90] as const;

export type CoordinateResult =
  | { ok: true; longitude: number; latitude: number }
  | { ok: false; message: string };

/**
 * 解析并校验一组经纬度文本。
 *
 * @param longitudeText 经度输入值
 * @param latitudeText 纬度输入值
 * @returns 校验通过时返回数值，否则返回可直接展示给用户的错误信息
 */
export function parseCoordinate(
  longitudeText: string,
  latitudeText: string,
): CoordinateResult {
  const longitude = parseFloat(longitudeText);
  const latitude = parseFloat(latitudeText);

  if (isNaN(longitude) || isNaN(latitude)) {
    return { ok: false, message: "请输入有效的经纬度" };
  }
  if (longitude < LONGITUDE_RANGE[0] || longitude > LONGITUDE_RANGE[1]) {
    return {
      ok: false,
      message: `经度范围应在 ${LONGITUDE_RANGE[0]} 到 ${LONGITUDE_RANGE[1]} 之间`,
    };
  }
  if (latitude < LATITUDE_RANGE[0] || latitude > LATITUDE_RANGE[1]) {
    return {
      ok: false,
      message: `纬度范围应在 ${LATITUDE_RANGE[0]} 到 ${LATITUDE_RANGE[1]} 之间`,
    };
  }
  return { ok: true, longitude, latitude };
}
