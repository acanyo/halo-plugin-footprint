<svelte:options
  customElement={{
    tag: "comment-ranking",
    props: {
      baseUrl: { reflect: true, type: "String", attribute: "base-url" },
      period: { reflect: true, type: "String", attribute: "period" },
      limit: { reflect: true, type: "Number", attribute: "limit" },
      title: { reflect: true, type: "String", attribute: "title" },
      showHeader: { reflect: true, type: "String", attribute: "show-header" },
      accentColor: { reflect: true, type: "String", attribute: "accent-color" },
      surfaceColor: { reflect: true, type: "String", attribute: "surface-color" },
      textColor: { reflect: true, type: "String", attribute: "text-color" },
    },
  }}
/>

<script lang="ts">
  import { getDefaultAnonymousAvatarUrl } from './avatar/weavatar';
  import { resolveApiUrl } from './services/api';

  type RankingPeriod = 'all' | 'week' | 'month' | 'quarter' | 'year';

  interface RankingItem {
    displayName?: string;
    avatar?: string;
    kind?: string;
    commentCount?: number;
  }

  interface RankingResponse {
    items?: RankingItem[];
  }

  const {
    baseUrl = '',
    period = 'all',
    limit = 10,
    title = '评论读者榜',
    showHeader = true,
    accentColor = '',
    surfaceColor = '',
    textColor = '',
  }: {
    baseUrl?: string;
    period?: RankingPeriod;
    limit?: number;
    title?: string;
    showHeader?: boolean | string;
    accentColor?: string;
    surfaceColor?: string;
    textColor?: string;
  } = $props();

  let items = $state<RankingItem[]>([]);
  let loading = $state(true);
  let error = $state('');
  let failedAvatarUrls = $state<string[]>([]);

  const isHeaderVisible = $derived(showHeader !== false && showHeader !== 'false');
  const periodLabels: Record<RankingPeriod, string> = {
    all: '全部时间',
    week: '本周',
    month: '本月',
    quarter: '本季度',
    year: '今年',
  };
  const componentStyle = $derived(
    [
      colorVariable('--comment-ranking-accent-color', accentColor),
      colorVariable('--comment-ranking-surface-color', surfaceColor),
      colorVariable('--comment-ranking-text-color', textColor),
    ]
      .filter(Boolean)
      .join(';'),
  );

  $effect(() => {
    const controller = new AbortController();
    const safePeriod = periodLabels[period] ? period : 'all';
    const safeLimit = Math.min(Math.max(Math.round(Number(limit) || 10), 1), 50);

    loading = true;
    error = '';
    void fetchRanking(safePeriod, safeLimit, controller.signal);

    return () => controller.abort();
  });

  async function fetchRanking(
    safePeriod: RankingPeriod,
    safeLimit: number,
    signal: AbortSignal,
  ) {
    try {
      const endpoint = resolveApiUrl(
        baseUrl,
        `/apis/api.commentnext.xhhao.com/v1alpha1/comments/ranking?period=${safePeriod}&limit=${safeLimit}`,
      );
      const response = await fetch(endpoint, { signal });
      if (!response.ok) {
        throw new Error(`排行榜加载失败（${response.status}）`);
      }

      const result = (await response.json()) as RankingResponse;
      items = Array.isArray(result.items) ? result.items : [];
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        return;
      }
      error = fetchError instanceof Error ? fetchError.message : '排行榜加载失败';
      items = [];
    } finally {
      if (!signal.aborted) {
        loading = false;
      }
    }
  }

  function colorVariable(name: string, value: string): string {
    const color = value.trim();
    return /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ? `${name}:${color}` : '';
  }

  function avatarUrl(item: RankingItem): string {
    return item.avatar?.trim() || getDefaultAnonymousAvatarUrl(160);
  }

  function displayName(item: RankingItem): string {
    return item.displayName?.trim() || '匿名读者';
  }

  function commentCount(item: RankingItem): number {
    return Math.max(0, Number(item.commentCount) || 0);
  }

  function markAvatarFailed(url: string): void {
    if (!failedAvatarUrls.includes(url)) {
      failedAvatarUrls = [...failedAvatarUrls, url];
    }
  }
</script>

<section class="comment-ranking" aria-label={title} style={componentStyle || undefined}>
  {#if isHeaderVisible}
    <header class="comment-ranking__header">
      <h2>{title}</h2>
      <p class="comment-ranking__summary">
        <span>{periodLabels[period] || periodLabels.all}</span>
        {#if items.length > 0}
          <span>{items.length} 位读者</span>
        {/if}
      </p>
    </header>
  {/if}

  {#if loading}
    <div class="comment-ranking__state" aria-live="polite">正在加载读者排行…</div>
  {:else if error}
    <div class="comment-ranking__state comment-ranking__state--error" role="alert">{error}</div>
  {:else if items.length === 0}
    <div class="comment-ranking__state">暂时还没有评论数据</div>
  {:else}
    <ol class="comment-ranking__readers" aria-label="读者排名">
      {#each items as item, index (`reader:${item.kind ?? 'reader'}:${item.displayName ?? 'anonymous'}:${index}`)}
        <li>
          <div class="comment-ranking__portrait-wrap">
            <div class="comment-ranking__portrait">
              <span class="comment-ranking__fallback" aria-hidden="true">{Array.from(displayName(item))[0]}</span>
              {#if !failedAvatarUrls.includes(avatarUrl(item))}
                <img
                  src={avatarUrl(item)}
                  alt=""
                  loading={index < 6 ? 'eager' : 'lazy'}
                  onerror={() => markAvatarFailed(avatarUrl(item))}
                />
              {/if}
            </div>
            <span class="comment-ranking__rank" aria-label={`第 ${index + 1} 名`}>{index + 1}</span>
          </div>
          <strong title={displayName(item)}>{displayName(item)}</strong>
          <small>{commentCount(item)} 条评论</small>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  :host {
    display: block;
    width: 100%;
    container-type: inline-size;
  }

  .comment-ranking {
    --ranking-accent: var(--comment-ranking-accent-color, #14b8a6);
    --ranking-surface: var(--comment-ranking-surface-color, transparent);
    --ranking-cutout: var(
      --comment-ranking-surface-color,
      var(--comment-next-surface-bg-color, #fff)
    );
    --ranking-text: var(
      --comment-ranking-text-color,
      var(--comment-next-text-color, #172033)
    );
    --ranking-muted: color-mix(in srgb, var(--ranking-text) 58%, var(--ranking-cutout));
    --ranking-rule: color-mix(in srgb, var(--ranking-text) 13%, var(--ranking-cutout));

    box-sizing: border-box;
    width: 100%;
    padding: clamp(1.15rem, 4cqi, 2.25rem);
    border-radius: var(--comment-next-radius-lg, 1rem);
    background: var(--ranking-surface);
    color: var(--ranking-text);
    font-family: var(--comment-next-font-family, ui-sans-serif, system-ui, sans-serif);
  }

  .comment-ranking__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--ranking-rule);
  }

  .comment-ranking__header h2 {
    margin: 0;
    font-size: clamp(1.05rem, 3cqi, 1.25rem);
    font-weight: 720;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .comment-ranking__summary {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin: 0;
    color: var(--ranking-muted);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .comment-ranking__summary span + span::before {
    margin-right: 0.65rem;
    color: var(--ranking-rule);
    content: "·";
  }

  .comment-ranking__readers {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: center;
    gap: clamp(1.35rem, 4cqi, 2rem) clamp(0.8rem, 3cqi, 1.35rem);
    margin: 0;
    padding: clamp(1.8rem, 5cqi, 2.8rem) 0 0;
    list-style: none;
  }

  .comment-ranking__readers li {
    --portrait-size: clamp(3.35rem, 8cqi, 4rem);
    --reader-width: clamp(4.2rem, 11cqi, 5.15rem);

    display: flex;
    width: var(--reader-width);
    min-width: 0;
    align-items: center;
    flex: 0 0 var(--reader-width);
    flex-direction: column;
    text-align: center;
  }

  .comment-ranking__readers li:first-child {
    --portrait-size: clamp(6.7rem, 17cqi, 8.4rem);
    --reader-width: clamp(7.7rem, 20cqi, 9.4rem);
  }

  .comment-ranking__readers li:nth-child(2),
  .comment-ranking__readers li:nth-child(3) {
    --portrait-size: clamp(5.1rem, 13cqi, 6.4rem);
    --reader-width: clamp(6rem, 15cqi, 7.2rem);
  }

  .comment-ranking__readers li:nth-child(n + 4):nth-child(-n + 9) {
    --portrait-size: clamp(4rem, 10cqi, 4.8rem);
    --reader-width: clamp(4.9rem, 12cqi, 5.8rem);
  }

  .comment-ranking__portrait-wrap {
    position: relative;
    width: var(--portrait-size);
    height: var(--portrait-size);
    margin-bottom: 0.55rem;
  }

  .comment-ranking__portrait {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    border-radius: 999px;
    background: var(--ranking-cutout);
  }

  .comment-ranking__portrait img {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 1px solid var(--ranking-rule);
    border-radius: inherit;
    background: var(--ranking-cutout);
    object-fit: cover;
  }

  .comment-ranking__readers li:first-child .comment-ranking__portrait img {
    border: 2px solid var(--ranking-accent);
  }

  .comment-ranking__readers li:nth-child(2) .comment-ranking__portrait img,
  .comment-ranking__readers li:nth-child(3) .comment-ranking__portrait img {
    border-color: color-mix(in srgb, var(--ranking-accent) 62%, var(--ranking-cutout));
  }

  .comment-ranking__fallback {
    position: absolute;
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    border-radius: inherit;
    background: var(--comment-next-pill-bg-color, #f3f5f8);
    color: var(--ranking-text);
    font-size: clamp(0.95rem, 3cqi, 1.35rem);
    font-weight: 720;
  }

  .comment-ranking__rank {
    position: absolute;
    z-index: 2;
    right: -0.12rem;
    bottom: -0.12rem;
    display: grid;
    min-width: 1.42rem;
    height: 1.42rem;
    box-sizing: border-box;
    padding: 0 0.3rem;
    place-items: center;
    border: 2px solid var(--ranking-cutout);
    border-radius: 999px;
    background: var(--ranking-text);
    color: var(--ranking-cutout);
    font-size: 0.6rem;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .comment-ranking__readers li:first-child .comment-ranking__rank,
  .comment-ranking__readers li:nth-child(2) .comment-ranking__rank,
  .comment-ranking__readers li:nth-child(3) .comment-ranking__rank {
    background: var(--ranking-accent);
  }

  .comment-ranking__readers strong {
    display: block;
    width: 100%;
    overflow: hidden;
    color: var(--ranking-text);
    font-size: 0.73rem;
    font-weight: 650;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .comment-ranking__readers li:first-child strong {
    font-size: 0.9rem;
    font-weight: 720;
  }

  .comment-ranking__readers li:nth-child(2) strong,
  .comment-ranking__readers li:nth-child(3) strong {
    font-size: 0.8rem;
  }

  .comment-ranking__readers small {
    display: block;
    margin-top: 0.12rem;
    color: var(--ranking-muted);
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.35;
  }

  @media (hover: hover) {
    .comment-ranking__portrait {
      transition: transform 160ms ease;
    }

    .comment-ranking__readers li:hover .comment-ranking__portrait {
      transform: translateY(-0.2rem);
    }
  }

  .comment-ranking__state {
    padding: 3rem 0;
    color: var(--ranking-muted);
    font-size: 0.88rem;
    text-align: center;
  }

  .comment-ranking__state--error {
    color: var(--comment-next-error-color, #dc2626);
  }

  @container (max-width: 30rem) {
    .comment-ranking {
      padding-inline: 0.85rem;
    }

    .comment-ranking__readers {
      gap: 1.35rem 0.7rem;
    }
  }

  @container (max-width: 22rem) {
    .comment-ranking__header {
      align-items: start;
      flex-direction: column;
    }

    .comment-ranking__readers li:first-child {
      --portrait-size: 6.5rem;
      --reader-width: 7.25rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-ranking__portrait {
      transition: none;
    }
  }
</style>
