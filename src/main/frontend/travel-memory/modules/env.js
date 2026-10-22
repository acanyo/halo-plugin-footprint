/**
 * 运行环境常量。
 *
 * 这两项都是「进程内不变」的判定结果，但会被多个模块使用（标记尺寸、
 * 照片环门控、各种 SVG 绘制），所以收在一处，避免定义在某个业务模块里
 * 反而要别的模块反向依赖它。
 */

/** 粗指针（触屏）：标记与城市点都要放大一档，照片环在触屏上直接关闭。 */
export const COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

/** SVG 命名空间：createElementNS 每次都要用。 */
export const SVG_NS = 'http://www.w3.org/2000/svg';
