import { describe, expect, it } from 'vitest';
import { composeLetter, wrapText } from './postcard';
import type { Footprint } from '../types/footprint';

const fp = (over: Partial<Footprint['spec']> = {}): Footprint => ({
  metadata: { name: 'x' },
  spec: { name: '西湖之行', longitude: 120, latitude: 30, ...over },
});

/**
 * 只测纯逻辑（换行与文案组装）。canvas 绘制指令不测——那要靠像素比对，
 * 而它是逐字迁移的，引入断言反而会把「和旧版一致」变成「和我的理解一致」。
 */
describe('wrapText', () => {
  // 每个字符宽 10 的假测量函数，便于精确断言
  const measure = (s: string) => s.length * 10;

  it('按宽度换行', () => {
    expect(wrapText(measure, 'abcdef', 30)).toEqual(['abc', 'def']);
  });

  it('保留原有换行符', () => {
    expect(wrapText(measure, 'ab\ncd', 100)).toEqual(['ab', 'cd']);
  });

  it('单字符超宽时不会死循环', () => {
    expect(wrapText(measure, 'abc', 5)).toEqual(['a', 'b', 'c']);
  });

  it('空串返回一个空行', () => {
    expect(wrapText(measure, '', 100)).toEqual(['']);
  });

  it('宽度刚好放下时不换行', () => {
    expect(wrapText(measure, 'abc', 30)).toEqual(['abc']);
  });
});

describe('composeLetter', () => {
  it('包含日期、城市与行程名', () => {
    const s = composeLetter(fp({ city: '杭州市', createTime: '2025-04-12T00:00:00Z' }));
    expect(s).toContain('2025.04.12');
    expect(s).toContain('杭州市');
    expect(s).toContain('西湖之行');
  });

  it('缺日期与城市时用兜底文案，不出现 undefined', () => {
    const s = composeLetter(fp({ name: '' }));
    expect(s).toContain('某一天');
    expect(s).toContain('远方');
    expect(s).toContain('一次出发');
    expect(s).not.toContain('undefined');
  });

  it('描述超过 80 字截断并加省略号', () => {
    const long = '很'.repeat(200);
    const s = composeLetter(fp({ description: long }));
    expect(s).toContain('…');
    expect(s).not.toContain('很'.repeat(100));
  });

  it('没有编号和类型时不留下空的连接词', () => {
    const s = composeLetter(fp({ city: '杭州市' }));
    expect(s).not.toContain('编号是 。');
    expect(s).not.toContain('关于「」');
  });

  it('有编号和类型时正确拼接', () => {
    const s = composeLetter(fp({ city: '杭州市' }), 'A123', '高铁');
    expect(s).toContain('编号是 A123');
    expect(s).toContain('关于「高铁」');
  });
});
