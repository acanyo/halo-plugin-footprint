/**
 * 运行环境常量。
 *
 * 移动端判定在页面生命周期内不变，被抽屉、图片墙、时间线悬停等多处使用，
 * 单独收在这里，避免业务模块之间为了一个常量互相依赖。
 */

export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
