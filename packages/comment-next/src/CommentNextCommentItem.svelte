<script lang="ts">
import { untrack } from 'svelte';
import CommentNextAvatar from './CommentNextAvatar.svelte';
import CommentNextBadge from './CommentNextBadge.svelte';
import CommentNextContent from './CommentNextContent.svelte';
import CommentNextEnvironmentTags from './CommentNextEnvironmentTags.svelte';
import CommentNextIcon from './CommentNextIcon.svelte';
import CommentNextReactionButton from './CommentNextReactionButton.svelte';
import CommentNextReplyComposer from './CommentNextReplyComposer.svelte';
import CommentNextReplyItem from './CommentNextReplyItem.svelte';
import CommentNextReportButton from './CommentNextReportButton.svelte';
import CommentNextTooltip from './CommentNextTooltip.svelte';
import { fetchReplyPage, upvoteCommentTarget } from './services/comments';
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
  CommentNextBadge as CommentNextBadgeModel,
  CommentNextComment,
  CommentNextPageInfo,
} from './types/comment';
import type { CommentNextEmotePack } from './types/emote';
import { commentAnchor, getCommentAnchorHref } from './utils/comment-anchor';
import { formatRelativeTime } from './utils/date';
import {
  COMMENT_NEXT_UPVOTED_COMMENTS_KEY,
  hasRememberedUpvote,
  rememberedUpvoteCount,
  rememberUpvote,
  rememberUpvoteCount,
} from './utils/upvote';
import { getCommentEnvironmentTags } from './utils/user-agent';

const {
  baseUrl = '',
  comment,
  badges = [],
  badgeConfig = {},
  first = false,
  loggedIn = false,
  allowAnonymous = true,
  showCaptcha = false,
  captchaType = 'ALPHANUMERIC',
  captchaConfig,
  demoData = false,
  replySize = 10,
  showCommenterDevice = true,
  enableImageLightbox = true,
  aiConfig,
  reactionConfig,
  reportConfig,
  aiMentionName = '',
  uploadConfig,
  emoteConfig,
  emotePacks = [],
}: {
  baseUrl?: string;
  comment: CommentNextComment;
  badges?: CommentNextBadgeModel[];
  badgeConfig?: CommentNextBadgeConfig;
  first?: boolean;
  loggedIn?: boolean;
  allowAnonymous?: boolean;
  showCaptcha?: boolean;
  captchaType?: NonNullable<CommentNextSecurityConfig['captcha']>['type'];
  captchaConfig?: CommentNextSecurityConfig['captcha'];
  demoData?: boolean;
  replySize?: number;
  showCommenterDevice?: boolean;
  enableImageLightbox?: boolean;
  aiConfig?: CommentNextAiConfig;
  reactionConfig?: CommentNextReactionConfig;
  reportConfig?: CommentNextReportConfig;
  aiMentionName?: string;
  uploadConfig?: CommentNextUploadConfig;
  emoteConfig?: CommentNextEmoteConfig;
  emotePacks?: CommentNextEmotePack[];
} = $props();

let upvoted = $state(false);
let upvotes = $state(0);
let previousCommentId = $state('');
let replyComposerOpen = $state(false);
let quoteReply = $state<CommentNextComment | undefined>();
let replies = $state<CommentNextComment[]>(
  untrack(() => comment.replies ?? [])
);
let replyPage = $state<CommentNextPageInfo | undefined>(
  untrack(() => comment.replyPage)
);
let replyAuthors = $state<Record<string, string>>(
  buildReplyAuthorMap(untrack(() => comment.replies ?? []))
);
let repliesLoading = $state(false);
let repliesError = $state('');

const environmentTags = $derived(
  getCommentEnvironmentTags({
    userAgent: comment.userAgent,
  })
);
const replyCount = $derived(
  replyPage?.total ?? comment.stats?.replies ?? replies.length
);
const hasMoreReplies = $derived(
  Boolean(replyPage?.hasNext) || replyCount > replies.length
);
const remainingReplyCount = $derived(Math.max(replyCount - replies.length, 0));
const commentReactionEnabled = $derived(
  Boolean(reactionConfig?.enabled && reactionConfig.commentEnabled !== false)
);

$effect(() => {
  if (previousCommentId !== comment.id) {
    previousCommentId = comment.id;
    const rememberedUpvote = hasRememberedUpvote(
      COMMENT_NEXT_UPVOTED_COMMENTS_KEY,
      comment.id
    );
    upvoted = rememberedUpvote;
    upvotes = Math.max(
      comment.stats?.upvotes ?? 0,
      rememberedUpvoteCount(COMMENT_NEXT_UPVOTED_COMMENTS_KEY, comment.id) ??
        (rememberedUpvote ? 1 : 0)
    );
    replyComposerOpen = false;
    quoteReply = undefined;
    replies = comment.replies ?? [];
    replyPage = comment.replyPage;
    replyAuthors = buildReplyAuthorMap(replies);
    repliesError = '';
  }
});

async function handleLocalUpvote() {
  if (upvoted) {
    return;
  }

  upvoted = true;
  upvotes += 1;

  try {
    if (!demoData) {
      await upvoteCommentTarget({
        baseUrl,
        name: comment.id,
        plural: 'comments',
      });
    }
    rememberUpvote(COMMENT_NEXT_UPVOTED_COMMENTS_KEY, comment.id);
    rememberUpvoteCount(COMMENT_NEXT_UPVOTED_COMMENTS_KEY, comment.id, upvotes);
  } catch (error) {
    const rememberedUpvote = hasRememberedUpvote(
      COMMENT_NEXT_UPVOTED_COMMENTS_KEY,
      comment.id
    );
    upvoted = rememberedUpvote;
    upvotes = Math.max(
      comment.stats?.upvotes ?? 0,
      rememberedUpvoteCount(COMMENT_NEXT_UPVOTED_COMMENTS_KEY, comment.id) ??
        (rememberedUpvote ? 1 : 0)
    );
    console.warn('Failed to upvote comment', error);
  }
}

function handleReplyAction() {
  if (repliesLoading) {
    return;
  }

  openCommentReply();
}

function openCommentReply() {
  if (replyComposerOpen && !quoteReply) {
    closeReplyComposer();
    return;
  }

  quoteReply = undefined;
  replyComposerOpen = true;
}

function openQuoteReply(reply: CommentNextComment) {
  if (replyComposerOpen && quoteReply?.id === reply.id) {
    closeReplyComposer();
    return;
  }

  rememberReplyAuthor(reply);
  quoteReply = reply;
  replyComposerOpen = true;
}

function closeReplyComposer() {
  replyComposerOpen = false;
  quoteReply = undefined;
}

function handleReplyCreated(reply?: CommentNextComment) {
  if (reply?.id) {
    const existed = replies.some((item) => item.id === reply.id);
    replies = upsertReply(replies, reply);
    replyAuthors = {
      ...replyAuthors,
      ...buildReplyAuthorMap(replies),
      [reply.id]: reply.author.displayName,
    };
    if (!existed) {
      replyPage = incrementReplyTotal(replyPage, replies.length);
    }
  }

  closeReplyComposer();
  void reloadReplies();
  window.setTimeout(() => void reloadReplies(), 1800);
  window.setTimeout(() => void reloadReplies(), 5200);
}

function resolveReplyToName(reply: CommentNextComment): string {
  if (!reply.quoteReplyId) {
    return comment.author.displayName;
  }

  return (
    reply.replyToName ||
    replyAuthors[reply.quoteReplyId] ||
    replies.find((item) => item.id === reply.quoteReplyId)?.author
      .displayName ||
    ''
  );
}

function rememberReplyAuthor(reply: CommentNextComment) {
  if (!reply.id || !reply.author.displayName) {
    return;
  }

  replyAuthors = {
    ...replyAuthors,
    [reply.id]: reply.author.displayName,
  };
}

function buildReplyAuthorMap(
  items: CommentNextComment[]
): Record<string, string> {
  return items.reduce<Record<string, string>>((result, item) => {
    if (item.id && item.author.displayName) {
      result[item.id] = item.author.displayName;
    }
    return result;
  }, {});
}

function upsertReply(
  items: CommentNextComment[],
  reply: CommentNextComment
): CommentNextComment[] {
  if (items.some((item) => item.id === reply.id)) {
    return items.map((item) => (item.id === reply.id ? reply : item));
  }

  return [...items, reply];
}

function incrementReplyTotal(
  pageInfo: CommentNextPageInfo | undefined,
  fallbackTotal: number
): CommentNextPageInfo {
  if (!pageInfo) {
    return {
      page: 1,
      size: replySize,
      total: fallbackTotal,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    };
  }

  const total = Math.max(pageInfo.total + 1, fallbackTotal);
  return {
    ...pageInfo,
    total,
    totalPages: Math.max(Math.ceil(total / Math.max(pageInfo.size, 1)), 1),
  };
}

async function loadRemainingReplies() {
  if (repliesLoading || !hasMoreReplies) {
    return;
  }

  let nextPage = replyPage ? replyPage.page + 1 : 1;
  let append = Boolean(replyPage);
  let shouldContinue = true;

  while (shouldContinue) {
    const loadedPage = await loadReplies({
      page: nextPage,
      append,
    });

    if (!loadedPage?.hasNext) {
      shouldContinue = false;
      continue;
    }

    nextPage = loadedPage.page + 1;
    append = true;
  }
}

async function reloadReplies() {
  await loadReplies({ page: 1, append: false });
}

async function loadReplies({
  page,
  append,
}: {
  page: number;
  append: boolean;
}): Promise<CommentNextPageInfo | undefined> {
  try {
    repliesLoading = true;
    repliesError = '';

    const data = await fetchReplyPage({
      baseUrl,
      commentName: comment.id,
      page,
      size: replySize,
    });

    replies = append ? [...replies, ...data.items] : data.items;
    replyAuthors = {
      ...replyAuthors,
      ...buildReplyAuthorMap(replies),
    };
    replyPage = {
      page: data.page,
      size: data.size,
      total: data.total,
      totalPages: data.totalPages,
      hasNext: data.hasNext,
      hasPrevious: data.hasPrevious,
    };
    return replyPage;
  } catch (error) {
    console.error(error);
    repliesError = '回复加载失败';
    return undefined;
  } finally {
    repliesLoading = false;
  }
}
</script>

<article
  use:commentAnchor={{ kind: 'comment', id: comment.id }}
  class:comment-next-comment-item-first={first}
  class="comment-next-comment-item"
>
  <div class="comment-next-comment-avatar">
    {#if comment.author.website}
      <a href={comment.author.website} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={comment.author.displayName}>
        <CommentNextAvatar src={comment.author.avatar} alt={comment.author.displayName} size={38} />
      </a>
    {:else}
      <CommentNextAvatar src={comment.author.avatar} alt={comment.author.displayName} size={38} />
    {/if}
  </div>

  <div class="comment-next-comment-main">
    <header class="comment-next-comment-meta">
      {#if comment.author.website}
        <a
          class="comment-next-comment-author"
          href={comment.author.website}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
        >
          {comment.author.displayName}
        </a>
      {:else}
        <span class="comment-next-comment-author">{comment.author.displayName}</span>
      {/if}

      <span class="comment-next-comment-badges" aria-label="评论者徽章">
        {#each badges as badge}
          <CommentNextBadge {badge} />
        {/each}
      </span>

      {#if comment.top || comment.featured}
        <span class="comment-next-comment-flags" aria-label="评论状态">
          {#if comment.top}
            <CommentNextTooltip text="这条评论已被置顶" align="start">
              <span class="comment-next-comment-flag comment-next-comment-flag-pinned">
                <CommentNextIcon name="pin" size={12} />
                置顶
              </span>
            </CommentNextTooltip>
          {/if}
          {#if comment.featured}
            <CommentNextTooltip text="这条评论已被站长精选" align="start">
              <span class="comment-next-comment-flag comment-next-comment-flag-featured">
                <CommentNextIcon name="star" size={12} />
                精选
              </span>
            </CommentNextTooltip>
          {/if}
        </span>
      {/if}

      {#if comment.private}
        <CommentNextTooltip text="只有评论者和管理员可见" align="start">
          <span class="comment-next-comment-state">
            <CommentNextIcon name="lock" size={12} />
            私密
          </span>
        </CommentNextTooltip>
      {/if}

      {#if comment.approved === false}
        <span class="comment-next-comment-state">待审核</span>
      {/if}
    </header>

    {#if comment.creationTime}
      <div class="comment-next-comment-submeta">
        <time>{formatRelativeTime(comment.creationTime)}</time>
        {#if showCommenterDevice}
          <CommentNextEnvironmentTags tags={environmentTags} compact />
        {/if}
      </div>
    {/if}

    <CommentNextContent
      content={comment.content}
      {aiMentionName}
      {enableImageLightbox}
      allowedLottieHosts={emoteConfig?.allowedHosts}
    />

    <footer class="comment-next-comment-actions">
      {#if commentReactionEnabled}
        <CommentNextReactionButton
          {baseUrl}
          targetType="COMMENT"
          name={comment.id}
          {loggedIn}
          config={reactionConfig}
          {demoData}
        />
      {:else}
        <button
          class:comment-next-comment-action-liked={upvoted}
          type="button"
          aria-label="点赞"
          onclick={handleLocalUpvote}
        >
          <CommentNextIcon name={upvoted ? "heartFill" : "heart"} size={15} />
          <span>{upvotes}</span>
        </button>
      {/if}
      <button type="button" aria-label="回复" disabled={repliesLoading} onclick={handleReplyAction}>
        <span class:comment-next-comment-action-loading={repliesLoading}>
          <CommentNextIcon name={repliesLoading ? "loader" : "reply"} size={15} />
        </span>
        <span>{repliesLoading ? "加载中" : "回复"}</span>
        {#if replyCount > 0}
          <span>{replyCount}</span>
        {/if}
      </button>
      <CommentNextReportButton
        {baseUrl}
        targetType="COMMENT"
        name={comment.id}
        {loggedIn}
        config={reportConfig}
        {demoData}
      />
      <a
        class="comment-next-comment-anchor"
        href={getCommentAnchorHref('comment', comment.id)}
        aria-label="跳转到此评论"
        title="评论链接"
      >
        <CommentNextIcon name="link" size={14} />
        <span>链接</span>
      </a>
    </footer>

    {#if replyComposerOpen && !quoteReply}
      <div class="comment-next-reply-composer-slot">
        <CommentNextReplyComposer
          {baseUrl}
          commentId={comment.id}
          {loggedIn}
          {allowAnonymous}
          {showCaptcha}
          {captchaType}
          {captchaConfig}
          {aiConfig}
          {uploadConfig}
          {emoteConfig}
          {emotePacks}
          replyToName={comment.author.displayName}
          onCancel={closeReplyComposer}
          onCreated={handleReplyCreated}
        />
      </div>
    {/if}

    {#if replies.length || repliesLoading || repliesError || hasMoreReplies}
      <div class="comment-next-replies">
        {#each replies as reply (reply.id)}
          <CommentNextReplyItem
            {baseUrl}
            {reply}
            {badgeConfig}
            {demoData}
            {showCommenterDevice}
            {enableImageLightbox}
            {aiMentionName}
            {loggedIn}
            reactionConfig={reactionConfig}
            reportConfig={reportConfig}
            {emoteConfig}
            replyToName={resolveReplyToName(reply)}
            onReply={openQuoteReply}
          />
          {#if replyComposerOpen && quoteReply?.id === reply.id}
            <div class="comment-next-reply-composer-slot comment-next-reply-composer-slot-nested">
              <CommentNextReplyComposer
                {baseUrl}
                commentId={comment.id}
                {loggedIn}
                {allowAnonymous}
                {showCaptcha}
                {captchaType}
                {captchaConfig}
                {aiConfig}
                {uploadConfig}
                {emoteConfig}
                {emotePacks}
                replyToName={reply.author.displayName}
                quoteReply={reply}
                onCancel={closeReplyComposer}
                onCreated={handleReplyCreated}
              />
            </div>
          {/if}
        {/each}

        {#if repliesError}
          <div class="comment-next-replies-message">
            <span>{repliesError}</span>
            <button type="button" onclick={loadRemainingReplies}>重试</button>
          </div>
        {:else if repliesLoading}
          <div class="comment-next-replies-message">
            <span class="comment-next-replies-more-loading">
              <CommentNextIcon name="loader" size={14} />
            </span>
            <span>正在加载回复</span>
          </div>
        {:else if hasMoreReplies}
          <div class="comment-next-replies-message">
            <button type="button" onclick={loadRemainingReplies}>
              展开剩余 {remainingReplyCount} 条回复
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</article>

<style>
  .comment-next-comment-item {
    --at-apply: relative grid grid-cols-[2.625rem_minmax(0,1fr)] gap-3.5 py-[1.125rem] px-0;
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
  }

  .comment-next-comment-item:not(.comment-next-comment-item-first) {
    --at-apply: border-t border-t-solid [border-top-color:var(--comment-next-border-subtle-color,#e7ecf2)];
  }

  .comment-next-comment-avatar {
    --at-apply: w-[2.625rem] min-w-0 justify-self-start self-start pt-0.5 leading-none;
  }

  .comment-next-comment-avatar a {
    --at-apply: inline-flex h-fit w-fit flex-none items-center justify-center rounded-full text-inherit no-underline leading-none;
  }

  .comment-next-comment-main {
    --at-apply: min-w-0;
    box-sizing: border-box;
    max-width: 100%;
  }

  .comment-next-comment-meta {
    --at-apply: mb-[0.2rem] flex min-w-0 flex-wrap items-center gap-[0.4rem];
  }

  .comment-next-comment-author {
    --at-apply: max-w-56 overflow-hidden text-ellipsis whitespace-nowrap text-[0.9375rem] text-[var(--comment-next-text-color,#172033)] font-extrabold no-underline;
  }

  .comment-next-comment-author:hover {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-comment-badges {
    --at-apply: inline-flex flex-wrap items-center gap-1;
  }

  .comment-next-comment-flags {
    --at-apply: inline-flex flex-wrap items-center gap-1;
  }

  .comment-next-comment-flag {
    --at-apply: inline-flex h-[1.25rem] items-center gap-1 rounded-full border border-solid px-1.5 text-[0.6875rem] font-[760] leading-none;
  }

  .comment-next-comment-flag-pinned {
    --at-apply: [border-color:var(--comment-next-pinned-border-color,rgb(252_211_77))] bg-[var(--comment-next-pinned-pill-bg-color,rgb(254_243_199))] text-[var(--comment-next-pinned-text-color,rgb(146_64_14))];
  }

  .comment-next-comment-flag-featured {
    --at-apply: [border-color:var(--comment-next-featured-border-color,rgb(153_246_228))] bg-[var(--comment-next-featured-pill-bg-color,rgb(204_251_241))] text-[var(--comment-next-featured-text-color,rgb(15_118_110))];
  }

  .comment-next-comment-submeta,
  .comment-next-comment-state {
    --at-apply: inline-flex items-center gap-2 text-xs text-[var(--comment-next-muted-color,#6b7687)] font-[560];
  }

  .comment-next-comment-submeta {
    --at-apply: mb-2 flex-wrap;
  }

  .comment-next-comment-actions {
    --at-apply: mt-[0.55rem] flex items-center gap-3;
  }

  .comment-next-comment-actions button,
  .comment-next-comment-anchor {
    --at-apply: inline-flex h-6 min-w-0 box-border cursor-pointer items-center justify-start gap-1 border-0 rounded-none bg-transparent p-0 text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[680] font-inherit transition-[color,transform] duration-140 ease-in-out;
    text-decoration: none;
  }

  .comment-next-comment-actions button:hover,
  .comment-next-comment-anchor:hover {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-comment-actions button:disabled {
    --at-apply: cursor-wait opacity-76;
  }

  .comment-next-comment-actions .comment-next-comment-action-liked,
  .comment-next-comment-actions .comment-next-comment-action-liked:hover {
    --at-apply: text-[var(--comment-next-like-color,#ef4444)];
  }

  .comment-next-comment-action-loading {
    --at-apply: animate-spin;
  }

  .comment-next-comment-actions button:active,
  .comment-next-comment-anchor:active {
    --at-apply: translate-y-px;
  }

  .comment-next-replies {
    --at-apply: relative ml-0.5 mt-3.5 rounded-none border-l border-l-dashed [border-left-color:var(--comment-next-reply-guide-color,#c8d8ee)] bg-transparent py-0.5 pl-4 pr-0;
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
  }

  .comment-next-reply-composer-slot {
    --at-apply: mt-3.5;
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
  }

  .comment-next-reply-composer-slot-nested {
    --at-apply: ml-[2.375rem] mr-0 mb-3.5 mt-1;
    max-width: calc(100% - 2.375rem);
  }

  .comment-next-replies-message {
    --at-apply: flex items-center gap-2 px-0 pb-0 pt-2.5 text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[650];
  }

  .comment-next-replies-message button {
    --at-apply: inline-flex h-7 cursor-pointer items-center justify-center gap-[0.35rem] border-0 rounded-none bg-transparent px-2.5 py-0 text-[0.8125rem] text-[var(--comment-next-primary-color,rgb(59,130,246))] font-[650] font-inherit transition-[background-color,color] duration-140 ease-in-out;
  }

  .comment-next-replies-message button:hover {
    --at-apply: text-[var(--comment-next-primary-hover-color,#2563eb)];
  }

  .comment-next-replies-more-loading {
    --at-apply: animate-spin;
  }

  @media (max-width: 640px) {
    .comment-next-comment-item {
      --at-apply: grid-cols-[2rem_minmax(0,1fr)] gap-2.5 py-4 px-0;
    }

    .comment-next-comment-author {
      --at-apply: max-w-36;
    }

    .comment-next-reply-composer-slot-nested {
      --at-apply: ml-0;
      max-width: 100%;
    }

    .comment-next-replies {
      --at-apply: pl-3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-replies-message button {
      --at-apply: transition-none;
    }

    .comment-next-comment-action-loading,
    .comment-next-replies-more-loading {
      --at-apply: animate-none;
    }
  }
</style>
