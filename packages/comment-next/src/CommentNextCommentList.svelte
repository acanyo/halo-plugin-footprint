<script lang="ts">
import { onMount } from 'svelte';
import { resolveCommentBadges } from './badges/resolve';
import CommentNextCommentItem from './CommentNextCommentItem.svelte';
import CommentNextCommentSkeleton from './CommentNextCommentSkeleton.svelte';
import CommentNextIcon from './CommentNextIcon.svelte';
import { createDemoCommentPage, demoBadgeConfig } from './demo/comments';
import { fetchCommentPage } from './services/comments';
import type {
  CommentNextAiConfig,
  CommentNextEmoteConfig,
  CommentNextReactionConfig,
  CommentNextReportConfig,
  CommentNextSecurityConfig,
  CommentNextUploadConfig,
} from './services/config';
import type {
  CommentNextBadgeConfig,
  CommentNextComment,
  CommentNextCommentSort,
} from './types/comment';
import type { CommentNextEmotePack } from './types/emote';

const {
  baseUrl = '',
  group = '',
  kind = '',
  version = 'v1alpha1',
  name = '',
  loggedIn = false,
  allowAnonymous = true,
  showCaptcha = false,
  captchaType = 'ALPHANUMERIC',
  captchaConfig,
  demoData = false,
  pageSize = 20,
  replySize = 10,
  withReplies = true,
  showCommenterDevice = true,
  enableImageLightbox = true,
  badgeConfig: configuredBadgeConfig,
  aiConfig,
  reactionConfig,
  reportConfig,
  uploadConfig,
  emoteConfig,
  emotePacks = [],
}: {
  baseUrl?: string;
  group?: string;
  kind?: string;
  version?: string;
  name?: string;
  loggedIn?: boolean;
  allowAnonymous?: boolean;
  showCaptcha?: boolean;
  captchaType?: NonNullable<CommentNextSecurityConfig['captcha']>['type'];
  captchaConfig?: CommentNextSecurityConfig['captcha'];
  demoData?: boolean;
  pageSize?: number;
  replySize?: number;
  withReplies?: boolean;
  showCommenterDevice?: boolean;
  enableImageLightbox?: boolean;
  badgeConfig?: CommentNextBadgeConfig;
  aiConfig?: CommentNextAiConfig;
  reactionConfig?: CommentNextReactionConfig;
  reportConfig?: CommentNextReportConfig;
  uploadConfig?: CommentNextUploadConfig;
  emoteConfig?: CommentNextEmoteConfig;
  emotePacks?: CommentNextEmotePack[];
} = $props();

let comments = $state<CommentNextComment[]>([]);
let page = $state(1);
let total = $state(0);
let totalPages = $state(1);
let hasPrevious = $state(false);
let hasNext = $state(false);
let firstCommentId = $state('');
let loading = $state(false);
let errorMessage = $state('');
let sortMode = $state<CommentNextCommentSort>('latest');

const badgeConfig = $derived<CommentNextBadgeConfig>(
  demoData ? demoBadgeConfig : (configuredBadgeConfig ?? {})
);
const visibleComments = $derived(
  demoData ? sortComments(comments, sortMode) : comments
);
const paginationItems = $derived(resolvePaginationItems(page, totalPages));
const sortOptions: Array<{ label: string; value: CommentNextCommentSort }> = [
  { label: '最新', value: 'latest' },
  { label: '最热', value: 'hot' },
  { label: '最早', value: 'earliest' },
];
const aiMentionName = $derived(resolveAiMentionName(aiConfig));

onMount(() => {
  void refreshComments();

  const handleCreated = () => {
    void refreshComments({ scrollIntoView: true });
    scheduleCreatedRefreshes();
  };

  window.addEventListener('halo:comment:created', handleCreated);

  return () => {
    window.removeEventListener('halo:comment:created', handleCreated);
  };
});

async function refreshComments(options: { scrollIntoView?: boolean } = {}) {
  page = 1;
  await loadComments();

  if (options.scrollIntoView) {
    requestAnimationFrame(() => {
      document.querySelector('comment-next, comment-widget')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });
  }
}

function scheduleCreatedRefreshes() {
  window.setTimeout(() => void refreshComments(), 1800);
  window.setTimeout(() => void refreshComments(), 5200);
}

async function selectPage(
  nextPage: number,
  options: { scrollIntoView?: boolean } = {}
) {
  const normalizedPage = clampPage(nextPage);

  if (normalizedPage === page || loading) {
    return;
  }

  page = normalizedPage;
  await loadComments();

  if (options.scrollIntoView) {
    scrollCommentsIntoView();
  }
}

async function selectSort(nextSortMode: CommentNextCommentSort) {
  if (sortMode === nextSortMode || loading) {
    return;
  }

  sortMode = nextSortMode;
  await refreshComments();
}

async function loadComments() {
  if (demoData) {
    const demoPage = createDemoCommentPage();
    comments = demoPage.items;
    total = demoPage.total;
    totalPages = demoPage.totalPages;
    hasPrevious = demoPage.hasPrevious;
    hasNext = demoPage.hasNext;
    firstCommentId = demoPage.firstCommentId ?? '';
    errorMessage = '';
    return;
  }

  if (!group || !kind || !name) {
    comments = [];
    total = 0;
    totalPages = 1;
    hasPrevious = false;
    hasNext = false;
    firstCommentId = '';
    return;
  }

  try {
    loading = true;
    errorMessage = '';

    const data = await fetchCommentPage({
      baseUrl,
      group,
      kind,
      name,
      version,
      page,
      size: pageSize,
      replySize,
      withReplies,
      sort: sortMode,
    });

    comments = data.items;
    page = data.page;
    total = data.total;
    totalPages = Math.max(data.totalPages || 1, 1);
    hasPrevious = data.hasPrevious;
    hasNext = data.hasNext;
    firstCommentId = data.firstCommentId ?? '';
  } catch (error) {
    console.error(error);
    errorMessage = '评论列表加载失败';
    comments = [];
    total = 0;
    totalPages = 1;
    hasPrevious = false;
    hasNext = false;
    firstCommentId = '';
  } finally {
    loading = false;
  }
}

function isFirstComment(comment: CommentNextComment): boolean {
  return Boolean(firstCommentId && comment.id === firstCommentId);
}

function sortComments(
  items: CommentNextComment[],
  mode: CommentNextCommentSort
): CommentNextComment[] {
  if (mode === 'latest') {
    return [...items].sort((left, right) => {
      const moderationDiff = compareCommentModeration(left, right);
      return moderationDiff || commentTime(right) - commentTime(left);
    });
  }

  if (mode === 'earliest') {
    return [...items].sort((left, right) => {
      const moderationDiff = compareCommentModeration(left, right);
      return moderationDiff || commentTime(left) - commentTime(right);
    });
  }

  return [...items].sort((left, right) => {
    const moderationDiff = compareCommentModeration(left, right);
    if (moderationDiff) {
      return moderationDiff;
    }

    const upvotesDiff =
      (right.stats?.upvotes ?? 0) - (left.stats?.upvotes ?? 0);
    if (upvotesDiff) {
      return upvotesDiff;
    }

    return commentTime(right) - commentTime(left);
  });
}

function compareCommentModeration(
  left: CommentNextComment,
  right: CommentNextComment
): number {
  if (left.top !== right.top) {
    return left.top ? -1 : 1;
  }

  return (left.priority ?? 0) - (right.priority ?? 0);
}

function commentTime(comment: CommentNextComment): number {
  return comment.creationTime ? new Date(comment.creationTime).getTime() : 0;
}

function clampPage(nextPage: number): number {
  return Math.min(Math.max(nextPage, 1), Math.max(totalPages, 1));
}

function scrollCommentsIntoView() {
  requestAnimationFrame(() => {
    document.querySelector('comment-next, comment-widget')?.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    });
  });
}

function resolveAiMentionName(config?: CommentNextAiConfig): string {
  const value =
    config?.assistantMentionName ||
    config?.assistantDisplayName ||
    config?.assistantName ||
    '';

  if (!value.trim()) {
    return '';
  }

  return value.trim().startsWith('@') ? value.trim() : `@${value.trim()}`;
}

function resolvePaginationItems(
  currentPage: number,
  pageCount: number
): Array<number | 'ellipsis'> {
  const normalizedPageCount = Math.max(pageCount, 1);

  if (normalizedPageCount <= 7) {
    return Array.from({ length: normalizedPageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([
    1,
    normalizedPageCount,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);

  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (currentPage >= normalizedPageCount - 2) {
    pages.add(normalizedPageCount - 3);
    pages.add(normalizedPageCount - 2);
    pages.add(normalizedPageCount - 1);
  }

  const sortedPages = [...pages]
    .filter((item) => item >= 1 && item <= normalizedPageCount)
    .sort((left, right) => left - right);
  const items: Array<number | 'ellipsis'> = [];

  for (const item of sortedPages) {
    const previous = items.at(-1);
    if (typeof previous === 'number' && item - previous > 1) {
      items.push('ellipsis');
    }
    items.push(item);
  }

  return items;
}
</script>

<section class="comment-next-comments" aria-label="评论列表">
  <div class="comment-next-comments-bar">
    <div class="comment-next-comments-tabs" aria-label="评论排序">
      {#each sortOptions as option}
        <button
          class:comment-next-comments-tab-active={sortMode === option.value}
          type="button"
          disabled={loading && sortMode !== option.value}
          aria-pressed={sortMode === option.value}
          onclick={() => selectSort(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    {#if errorMessage}
      <button class="comment-next-comments-retry" type="button" onclick={() => refreshComments()}>
        <CommentNextIcon name="refresh" size={13} />
        重试
      </button>
    {/if}
  </div>

  {#if loading && !comments.length}
    <CommentNextCommentSkeleton />
  {:else if comments.length}
    <div class="comment-next-comments-list">
      {#each visibleComments as comment (comment.id)}
        <CommentNextCommentItem
          {baseUrl}
          {comment}
          badges={resolveCommentBadges(comment, { isFirstComment: isFirstComment(comment), config: badgeConfig })}
          {badgeConfig}
          first={isFirstComment(comment)}
          {loggedIn}
          {allowAnonymous}
          {showCaptcha}
          {captchaType}
          {captchaConfig}
          {demoData}
          {replySize}
          {showCommenterDevice}
          {enableImageLightbox}
          {aiConfig}
          {reactionConfig}
          {reportConfig}
          {aiMentionName}
          {uploadConfig}
          {emoteConfig}
          {emotePacks}
        />
      {/each}
    </div>
  {:else}
    <div class="comment-next-comments-empty">
      <span class="comment-next-comments-empty-icon">
        <CommentNextIcon name="message" size={18} />
      </span>
      <span>{errorMessage || "还没有评论"}</span>
    </div>
  {/if}

  {#if totalPages > 1}
    <nav class="comment-next-comments-pagination" aria-label={`评论分页，共 ${total} 条`}>
      <button
        class="comment-next-comments-page-control"
        type="button"
        disabled={loading || !hasPrevious}
        onclick={() => selectPage(page - 1, { scrollIntoView: true })}
      >
        上一页
      </button>

      <div class="comment-next-comments-page-list">
        {#each paginationItems as item, index}
          {#if item === 'ellipsis'}
            <span class="comment-next-comments-page-ellipsis" aria-hidden="true">...</span>
          {:else}
            <button
              class:comment-next-comments-page-active={item === page}
              type="button"
              disabled={loading || item === page}
              aria-current={item === page ? "page" : undefined}
              aria-label={`第 ${item} 页`}
              onclick={() => selectPage(item, { scrollIntoView: true })}
            >
              {item}
            </button>
          {/if}
        {/each}
      </div>

      <button
        class="comment-next-comments-page-control"
        type="button"
        disabled={loading || !hasNext}
        onclick={() => selectPage(page + 1, { scrollIntoView: true })}
      >
        {#if loading}
          <span class="comment-next-comments-pagination-loading">
            <CommentNextIcon name="loader" size={14} />
          </span>
        {/if}
        下一页
      </button>
    </nav>
  {/if}
</section>

<style>
  .comment-next-comments {
    --at-apply: box-border w-full text-[var(--comment-next-text-color,#172033)];
    max-width: 100%;
    min-width: 0;
    font-family: var(
      --comment-next-font-family,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif
    );
  }

  .comment-next-comments-bar {
    --at-apply: flex min-h-10 items-center justify-between gap-[1.125rem] border-b border-b-solid [border-bottom-color:var(--comment-next-border-subtle-color,#e3e9f0)];
  }

  .comment-next-comments-tabs {
    --at-apply: inline-flex min-w-0 items-stretch self-stretch gap-5;
  }

  .comment-next-comments-tabs button {
    --at-apply: relative inline-flex min-w-9 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-sm text-[var(--comment-next-muted-color,#6b7687)] font-[720] font-inherit transition-colors duration-140 ease-in-out;
  }

  .comment-next-comments-tabs button::after {
    --at-apply: absolute right-0 bottom-[-1px] left-0 h-0.5 rounded-full bg-transparent transition-colors duration-140 ease-in-out;
    content: "";
  }

  .comment-next-comments-tabs button:hover,
  .comment-next-comments-tabs .comment-next-comments-tab-active {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-comments-tabs .comment-next-comments-tab-active::after {
    --at-apply: bg-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-comments-tabs button:disabled {
    --at-apply: cursor-wait opacity-62;
  }

  .comment-next-comments-retry,
  .comment-next-comments-pagination button {
    --at-apply: inline-flex cursor-pointer items-center justify-center gap-[0.35rem] border border-solid [border-color:var(--comment-next-border-subtle-color,#dfe5ec)] bg-[var(--comment-next-toolbar-bg-color,#ffffff)] text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[680] font-inherit transition-[background-color,color,transform] duration-140 ease-in-out;
  }

  .comment-next-comments-retry {
    --at-apply: ml-auto h-7 rounded-lg px-2.5 py-0;
  }

  .comment-next-comments-retry:hover,
  .comment-next-comments-pagination button:hover {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-comments-list {
    --at-apply: grid;
    max-width: 100%;
    min-width: 0;
  }

  .comment-next-comments-empty {
    --at-apply: flex min-h-28 items-center justify-center gap-2 text-sm text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-comments-empty-icon {
    --at-apply: inline-flex h-8 w-8 items-center justify-center rounded-full border border-solid [border-color:var(--comment-next-border-subtle-color,#dfe5ec)] bg-[var(--comment-next-toolbar-bg-color,#ffffff)];
  }

  .comment-next-comments-pagination {
    --at-apply: flex flex-wrap items-center justify-center gap-2 pt-4;
  }

  .comment-next-comments-page-list {
    --at-apply: inline-flex items-center gap-1.5;
  }

  .comment-next-comments-pagination button {
    --at-apply: h-8 min-w-8 rounded-[0.625rem] px-2.5 py-0 tabular-nums;
  }

  .comment-next-comments-page-control {
    --at-apply: min-w-16 px-3.5;
  }

  .comment-next-comments-pagination .comment-next-comments-page-active {
    --at-apply: [border-color:var(--comment-next-primary-color,rgb(59,130,246))] bg-[var(--comment-next-pill-active-bg-color,rgb(239_246_255))] text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-comments-pagination button:disabled {
    --at-apply: cursor-not-allowed opacity-56;
  }

  .comment-next-comments-page-ellipsis {
    --at-apply: inline-flex h-8 min-w-5 items-center justify-center text-xs text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-comments-pagination-loading {
    --at-apply: animate-spin;
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-comments-retry,
    .comment-next-comments-tabs button,
    .comment-next-comments-tabs button::after,
    .comment-next-comments-pagination button {
      --at-apply: transition-none;
    }

    .comment-next-comments-pagination-loading {
      --at-apply: animate-none;
    }
  }
</style>
