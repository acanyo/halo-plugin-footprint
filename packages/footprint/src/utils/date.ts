/**
 * 日期格式化。
 *
 * 旧代码里三处各写了一份几乎相同的正则解析（`formatLightboxDate`、
 * `formatCityDate`、`ticketDate`），输出格式却各不相同。这里收敛成一个函数
 * 加三种格式，行为逐字保持一致——它们的差异是刻意的视觉设计，不是笔误。
 *
 * 全部走正则而非 `new Date()`：后端给的是 ISO 字符串，用 Date 解析会被浏览器
 * 时区调整，导致「2025-04-12」在东八区之外显示成前一天。
 */

export type DateStyle =
  /** 2025-04-12 14:30 —— 灯箱说明文字 */
  | 'lightbox'
  /** 2025 / 04.12 —— 城市卡片 */
  | 'city'
  /** 2025.04.12 —— 票根 */
  | 'ticket';

const FULL = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/;

const pad = (v: string | number) => String(v).padStart(2, '0');

export function formatDate(value: unknown, style: DateStyle = 'lightbox'): string {
  const raw = String(value ?? '').trim();

  if (style === 'ticket') {
    if (!raw) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : raw;
  }

  const m = FULL.exec(raw);
  if (!m) return raw || '日期未知';

  if (style === 'city') {
    return `${m[1]} / ${pad(m[2])}.${pad(m[3])}`;
  }

  const date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return m[4] ? `${date} ${pad(m[4])}:${m[5]}` : date;
}
