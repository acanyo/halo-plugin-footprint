import { describe, expect, it } from 'vitest';
import { applyImageRule, galleryOf, normalizeAttachmentUrl } from './image';
import type { FootprintConfig } from '../types/footprint';

const cfg = (over: Partial<FootprintConfig> = {}): Partial<FootprintConfig> => ({
  markerImageFrom: '',
  markerImageTo: '',
  markerImageSuffix: '',
  timelineImageFrom: '',
  timelineImageTo: '',
  timelineImageSuffix: '',
  cityWallImageFrom: '',
  cityWallImageTo: '',
  cityWallImageSuffix: '',
  ...over,
});

describe('applyImageRule', () => {
  it('未配置任何规则时原样返回', () => {
    expect(applyImageRule('https://x.com/a.jpg', cfg(), 'marker')).toBe('https://x.com/a.jpg');
  });

  it('from→to 替换所有出现位置', () => {
    const c = cfg({ markerImageFrom: '!w100', markerImageTo: '!A100' });
    expect(applyImageRule('https://x.com/a.jpg!w100', c, 'marker')).toBe(
      'https://x.com/a.jpg!A100'
    );
  });

  it('to 为空表示只删除 from 片段', () => {
    const c = cfg({ markerImageFrom: '!w100' });
    expect(applyImageRule('https://x.com/a.jpg!w100', c, 'marker')).toBe('https://x.com/a.jpg');
  });

  it('suffix 追加，且已以该后缀结尾时不重复追加', () => {
    const c = cfg({ markerImageSuffix: '/fw/200' });
    expect(applyImageRule('https://x.com/a.jpg', c, 'marker')).toBe('https://x.com/a.jpg/fw/200');
    expect(applyImageRule('https://x.com/a.jpg/fw/200', c, 'marker')).toBe(
      'https://x.com/a.jpg/fw/200'
    );
  });

  it('三套规则互不干扰', () => {
    const c = cfg({
      markerImageSuffix: '/fw/200',
      timelineImageSuffix: '/fw/500',
      cityWallImageSuffix: '/fw/300',
    });
    expect(applyImageRule('u', c, 'marker')).toBe('u/fw/200');
    expect(applyImageRule('u', c, 'timeline')).toBe('u/fw/500');
    expect(applyImageRule('u', c, 'cityWall')).toBe('u/fw/300');
  });

  // 这条是为兼容升级前站点刻意保留的行为，重构时极易被当成"规则不统一"抹掉
  describe('城市卡片墙的旧版回退', () => {
    it('三项都未配置时，沿用标记点的 from→to', () => {
      const c = cfg({ markerImageFrom: '!w100', markerImageTo: '!A100' });
      expect(applyImageRule('a.jpg!w100', c, 'cityWall')).toBe('a.jpg!A100');
    });

    it('回退时不追加标记点的 suffix', () => {
      const c = cfg({
        markerImageFrom: '!w100',
        markerImageTo: '!A100',
        markerImageSuffix: '/fw/200',
      });
      expect(applyImageRule('a.jpg!w100', c, 'cityWall')).toBe('a.jpg!A100');
    });

    it('只要城市卡片墙配了任意一项，就不再回退', () => {
      const c = cfg({
        markerImageFrom: '!w100',
        markerImageTo: '!A100',
        cityWallImageSuffix: '/fw/300',
      });
      expect(applyImageRule('a.jpg!w100', c, 'cityWall')).toBe('a.jpg!w100/fw/300');
    });
  });

  it('空值原样返回，不抛错', () => {
    expect(applyImageRule('', cfg(), 'marker')).toBe('');
    expect(applyImageRule(null, cfg(), 'marker')).toBe('');
    expect(applyImageRule(undefined, cfg(), 'marker')).toBe('');
  });
});

describe('normalizeAttachmentUrl', () => {
  it('字符串直接通过', () => {
    expect(normalizeAttachmentUrl('https://x.com/a.jpg')).toBe('https://x.com/a.jpg');
  });

  it('对象取 url/src/thumbnail/path/spec.url', () => {
    expect(normalizeAttachmentUrl({ url: '/upload/a.jpg' })).toBe('/upload/a.jpg');
    expect(normalizeAttachmentUrl({ src: '/upload/b.jpg' })).toBe('/upload/b.jpg');
    expect(normalizeAttachmentUrl({ spec: { url: '/upload/c.jpg' } })).toBe('/upload/c.jpg');
  });

  it('数组取第一个有效项', () => {
    expect(normalizeAttachmentUrl([{ url: '/a.jpg' }])).toBe('/a.jpg');
    expect(normalizeAttachmentUrl(['', '/b.jpg'])).toBe('/b.jpg');
  });

  it('对象绝不会被 String() 成 [object Object]', () => {
    expect(normalizeAttachmentUrl({ unknown: 1 })).toBe('');
  });

  it('协议相对地址补上当前协议', () => {
    expect(normalizeAttachmentUrl('//cdn.x.com/a.jpg')).toMatch(/^https?:\/\/cdn\.x\.com\/a\.jpg$/);
  });

  it('非法值返回空串', () => {
    expect(normalizeAttachmentUrl(null)).toBe('');
    expect(normalizeAttachmentUrl('javascript')).toBe('');
  });
});

describe('galleryOf', () => {
  const spec = (over: Record<string, unknown> = {}) =>
    ({ name: 'x', longitude: 0, latitude: 0, ...over }) as never;

  it('对象数组原样归一', () => {
    expect(galleryOf(spec({ galleryImages: [{ url: '/a.jpg', order: 1 }] }))).toEqual([
      { url: '/a.jpg', order: 1 },
    ]);
  });

  it('字符串数组转成对象', () => {
    expect(galleryOf(spec({ galleryImages: ['/a.jpg'] }))).toEqual([{ url: '/a.jpg', caption: '' }]);
  });

  it('JSON 字符串会被解析', () => {
    expect(galleryOf(spec({ galleryImages: '[{"url":"/a.jpg"}]' }))).toEqual([{ url: '/a.jpg' }]);
  });

  it('JSON 解析失败时回退到封面图而不是抛错', () => {
    expect(galleryOf(spec({ galleryImages: '{坏 JSON', image: '/cover.jpg' }))).toEqual([
      { url: '/cover.jpg', caption: '' },
    ]);
  });

  it('图集为空时回退到封面图', () => {
    expect(galleryOf(spec({ galleryImages: [], image: '/cover.jpg' }))).toEqual([
      { url: '/cover.jpg', caption: '' },
    ]);
  });

  it('什么都没有时返回空数组', () => {
    expect(galleryOf(spec())).toEqual([]);
    expect(galleryOf(null)).toEqual([]);
  });
});
