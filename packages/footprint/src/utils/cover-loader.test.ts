import { describe, expect, it, vi } from 'vitest';
import { CoverLoader } from './cover-loader';

describe('CoverLoader', () => {
  it('成功结果被缓存，同一 URL 不重复加载', async () => {
    const loader = vi.fn().mockResolvedValue(true);
    const cl = new CoverLoader(loader);
    await cl.load('/a.jpg');
    await cl.load('/a.jpg');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('并发不超过 3', async () => {
    let concurrent = 0;
    let peak = 0;
    const loader = vi.fn(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return true;
    });
    const cl = new CoverLoader(loader);
    await Promise.all(Array.from({ length: 10 }, (_, i) => cl.load(`/img${i}.jpg`)));
    expect(peak).toBeLessThanOrEqual(3);
    expect(loader).toHaveBeenCalledTimes(10);
  });

  it('首次失败后会重试一次', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const cl = new CoverLoader(loader);
    const p = cl.load('/a.jpg');
    await vi.advanceTimersByTimeAsync(3100);
    await expect(p).resolves.toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('重试仍失败则记为失败', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue(false);
    const cl = new CoverLoader(loader);
    const p = cl.load('/a.jpg');
    await vi.advanceTimersByTimeAsync(3100);
    await expect(p).resolves.toBe(false);
    expect(loader).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('失败结论一分钟后过期，会重新尝试', async () => {
    let clock = 0;
    const loader = vi.fn().mockResolvedValue(false);
    const cl = new CoverLoader(loader, () => clock);

    vi.useFakeTimers();
    const p1 = cl.load('/a.jpg');
    await vi.advanceTimersByTimeAsync(3100);
    await p1;
    const callsAfterFirst = loader.mock.calls.length;

    // 一分钟内：直接返回缓存的失败结论，不再发起加载
    clock = 30_000;
    await expect(cl.load('/a.jpg')).resolves.toBe(false);
    expect(loader).toHaveBeenCalledTimes(callsAfterFirst);

    // 超过一分钟：重新尝试
    clock = 61_000;
    const p2 = cl.load('/a.jpg');
    await vi.advanceTimersByTimeAsync(3100);
    await p2;
    expect(loader.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    vi.useRealTimers();
  });

  it('空 URL 直接返回 false，不进队列', async () => {
    const loader = vi.fn();
    const cl = new CoverLoader(loader);
    await expect(cl.load('')).resolves.toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });
});
