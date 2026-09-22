import type { Footprint } from '../types/footprint';

/**
 * 护照集章。
 *
 * 正式浏览票根时盖章记录（**本机存储**，不上传服务端），集齐后显示金色封面。
 * 「正式浏览」的判定是停留超过一定时长，避免快速翻页把所有章都刷出来——
 * 这是原实现的设计，集章的意义在于「真的看过」。
 */

const STORAGE_KEY = 'footprint-ticket-passport-v1';

/** 停留超过这个时长才算正式浏览 */
export const STAMP_DWELL_MS = 1500;

export interface StampRecord {
  /** 票根标识 */
  id: string;
  /** 盖章时间戳 */
  at: number;
}

/**
 * 票根标识。
 *
 * 优先用足迹的 metadata.name（稳定唯一）。原实现因为没有这个字段，
 * 退而用票根图 URL 或多字段拼接，那在换图后会丢章。
 */
export function stampIdOf(fp: Footprint): string {
  return fp.metadata.name || fp.spec.name || '';
}

export function loadStamps(): StampRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    // 隐私模式或数据损坏：当作没盖过章，不影响浏览
    return [];
  }
}

function save(records: StampRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 存不下就算了，集章属于附加体验
  }
}

/** 盖章。已盖过的不重复记录，返回是否为新章。 */
export function addStamp(id: string): boolean {
  if (!id) return false;
  const records = loadStamps();
  if (records.some((r) => r.id === id)) return false;
  records.push({ id, at: Date.now() });
  save(records);
  return true;
}

export function hasStamp(id: string): boolean {
  return loadStamps().some((r) => r.id === id);
}

export function resetStamps(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
}

export interface PassportProgress {
  collected: number;
  total: number;
  /** 集齐后显示金色封面 */
  complete: boolean;
}

export function passportProgress(tickets: Footprint[]): PassportProgress {
  const ids = new Set(loadStamps().map((r) => r.id));
  const collected = tickets.filter((fp) => ids.has(stampIdOf(fp))).length;
  return {
    collected,
    total: tickets.length,
    complete: tickets.length > 0 && collected === tickets.length,
  };
}

/**
 * 命运抽票：从已有票根里洗牌抽一张，并从**未收录票根的城市**中给出灵感。
 *
 * @param random 便于测试注入确定的随机源
 */
export function drawOracle(
  tickets: Footprint[],
  allFootprints: Footprint[],
  random: () => number = Math.random
): { picked: Footprint | null; inspiration: string } {
  if (!tickets.length) return { picked: null, inspiration: '' };

  const picked = tickets[Math.floor(random() * tickets.length)];

  const ticketCities = new Set(tickets.map((fp) => fp.spec.city).filter(Boolean));
  const candidates = [
    ...new Set(
      allFootprints
        .map((fp) => fp.spec.city)
        .filter((c): c is string => !!c && !ticketCities.has(c))
    ),
  ];
  const inspiration = candidates.length
    ? candidates[Math.floor(random() * candidates.length)]
    : '';

  return { picked, inspiration };
}
