import type { Footprint } from '../types/footprint';
import { formatDate } from './date';

/**
 * 「未寄出的明信片」画布绘制。
 *
 * **刻意不引任何 canvas / 截图库**：这是 900×1280 的手写 2D 绘制，输出需要
 * 与旧版像素级一致，换库等于换视觉。绘制指令、坐标、字号、配色全部逐字迁移，
 * 只做了「从闭包里搬出来 + 加类型」这两件事。
 *
 * 唯一的结构性调整：文本换行从依赖外部函数改为本模块自带，
 * 这样整个绘制过程不再依赖任何外部状态，可独立调用与测试。
 */

const W = 900;
const H = 1280;

const COLORS = {
  ink: '#35423d',
  muted: '#8b7865',
  accent: '#9b704e',
  placeholder: '#e4dccd',
  border: 'rgba(118,92,61,0.34)',
} as const;

/** 票根图区域 */
const SHOT_X = 40;
const SHOT_W = 820;
const SHOT_TOP = 168;
const SHOT_MAX_H = 520;

const LINE_HEIGHT = 46;
const TEXT_LEFT = 70;
const TEXT_MAX_W = 760;
/** 落款基线，正文不能压过它 */
const SIGN_LIMIT = 1224;

/**
 * 按测量宽度换行。
 *
 * 逐字符测量而非按词切分：正文以中文为主，没有空格可依。
 */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/** 组装信件正文。文案逐字保留。 */
export function composeLetter(fp: Footprint, ticketNo?: string, ticketType?: string): string {
  const spec = fp.spec;
  const date = formatDate(spec.createTime, 'ticket');
  const desc = String(spec.description ?? '').trim();
  const noText = ticketNo ? `，编号是 ${ticketNo}` : '';
  const typeText = ticketType ? `；那是一段关于「${ticketType}」的旅程` : '';
  const descText = desc ? ` 我还记得：${desc.length > 80 ? desc.slice(0, 80) + '…' : desc}` : '';

  return (
    '致许多年后的自己：\n' +
    `这一张票根，写于${date || '某一天'}的${spec.city || '远方'}。\n` +
    `那时候的旅程叫「${spec.name || '一次出发'}」${noText}${typeText}。` +
    `${descText}当时没有说出口的话，都留在这张纸里了。\n` +
    '—— 一张票根，代替当时的我寄出。'
  );
}

export interface PostcardOptions {
  footprint: Footprint;
  /** 已加载完成的票根图；取不到时用首字占位 */
  image?: HTMLImageElement | null;
  ticketNo?: string;
  ticketType?: string;
}

export function drawPostcard(opts: PostcardOptions): HTMLCanvasElement {
  const { footprint: fp, image } = opts;
  const spec = fp.spec;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 纸面渐变 + 内框
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#e8e0d2');
  bg.addColorStop(1, '#d6cbb8');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, 852, 1232);

  // 抬头
  ctx.fillStyle = COLORS.accent;
  ctx.font = '600 24px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('A LETTER FROM A TICKET', 450, 78);
  ctx.fillStyle = COLORS.ink;
  ctx.font = '400 44px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
  ctx.fillText('未寄出的明信片', 450, 132);

  // 票根图直接贴在纸面上：不垫白卡、不加粗边框，按内容宽度铺满，
  // 高度由图片自身比例决定；下面的正文起点跟着图高浮动，长图短图都不会顶到文字。
  let shotBottom = SHOT_TOP + 360;
  if (image) {
    const scale = Math.min(SHOT_W / image.width, SHOT_MAX_H / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, SHOT_X + (SHOT_W - dw) / 2, SHOT_TOP, dw, dh);
    shotBottom = SHOT_TOP + dh;
  } else {
    ctx.fillStyle = COLORS.placeholder;
    ctx.fillRect(SHOT_X, SHOT_TOP, SHOT_W, shotBottom - SHOT_TOP);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 150px "Noto Serif SC", "Songti SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText((spec.city || '?').charAt(0), 450, SHOT_TOP + 260);
  }

  // 图下小字：城市 · 日期 · 票根名
  ctx.fillStyle = COLORS.muted;
  ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    [spec.city, formatDate(spec.createTime, 'ticket'), spec.name].filter(Boolean).join(' · '),
    450,
    shotBottom + 44
  );

  // 信件正文
  ctx.fillStyle = COLORS.ink;
  ctx.font = '400 30px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
  ctx.textAlign = 'left';
  const lines = wrapText((s) => ctx.measureText(s).width, composeLetter(fp, opts.ticketNo, opts.ticketType), TEXT_MAX_W);
  const startY = shotBottom + 106;
  // 行数按剩余高度算：图高变化时不会把落款挤出去
  const maxLines = Math.max(4, Math.floor((SIGN_LIMIT - startY) / LINE_HEIGHT));
  lines.slice(0, maxLines).forEach((line, i) => {
    ctx.fillText(line, TEXT_LEFT, startY + i * LINE_HEIGHT);
  });

  // 落款
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.muted;
  ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
  ctx.fillText('旅行记忆 · 票根收藏', 852, 1245);

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
