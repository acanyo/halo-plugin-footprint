import { describe, expect, it } from 'vitest';
import { formatDate } from './date';

/**
 * 黄金值取自迁移前 travel-memory.js 的 formatLightboxDate / formatCityDate /
 * ticketDate 三个函数。三者输出格式不同是刻意的视觉设计，迁移时合并成一个
 * 函数加 style 参数，但每种 style 的输出必须与原函数完全一致。
 */
describe('formatDate', () => {
  describe('lightbox（原 formatLightboxDate）', () => {
    it.each([
      ['2025-04-12T14:30:00Z', '2025-04-12 14:30'],
      ['2025-04-12 09:05', '2025-04-12 09:05'],
      ['2025-4-2', '2025-04-02'],
      ['2025/04/12', '2025-04-12'],
      ['', '日期未知'],
      ['不是日期', '不是日期'],
    ])('%s → %s', (input, expected) => {
      expect(formatDate(input, 'lightbox')).toBe(expected);
    });

    it('无值时返回占位而不是空串', () => {
      expect(formatDate(null, 'lightbox')).toBe('日期未知');
      expect(formatDate(undefined, 'lightbox')).toBe('日期未知');
    });
  });

  describe('city（原 formatCityDate）', () => {
    it.each([
      ['2025-04-12T14:30:00Z', '2025 / 04.12'],
      ['2025-4-2', '2025 / 04.02'],
      ['', '日期未知'],
    ])('%s → %s', (input, expected) => {
      expect(formatDate(input, 'city')).toBe(expected);
    });
  });

  describe('ticket（原 ticketDate）', () => {
    it.each([
      ['2025-04-12T14:30:00Z', '2025.04.12'],
      ['2025-04-12', '2025.04.12'],
      // 原实现只认严格的 YYYY-MM-DD，单位数月份不匹配就原样返回
      ['2025-4-2', '2025-4-2'],
      ['不是日期', '不是日期'],
    ])('%s → %s', (input, expected) => {
      expect(formatDate(input, 'ticket')).toBe(expected);
    });

    it('无值时返回空串（与另外两种 style 不同，这是原行为）', () => {
      expect(formatDate('', 'ticket')).toBe('');
      expect(formatDate(null, 'ticket')).toBe('');
    });
  });

  it('不使用 Date 解析，避免时区把日期推前一天', () => {
    // 若用 new Date('2025-04-12') 再 getDate()，在 UTC-5 等时区会得到 11 号
    expect(formatDate('2025-04-12T00:00:00Z', 'lightbox')).toBe('2025-04-12 00:00');
  });
});
