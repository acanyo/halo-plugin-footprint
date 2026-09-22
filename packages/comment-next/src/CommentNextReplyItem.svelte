<script lang="ts">
import { resolveCommentBadges } from './badges/resolve';
import CommentNextAvatar from './CommentNextAvatar.svelte';
import CommentNextBadge from './CommentNextBadge.svelte';
import CommentNextContent from './CommentNextContent.svelte';
import CommentNextEnvironmentTags from './CommentNextEnvironmentTags.svelte';
import CommentNextIcon from './CommentNextIcon.svelte';
import CommentNextReactionButton from './CommentNextReactionButton.svelte';
import CommentNextReportButton from './CommentNextReportButton.svelte';
import { upvoteCommentTarget } from './services/comments';
import type {
  CommentNextEmoteConfig,
  CommentNextReactionConfig,
  CommentNextReportConfig,
} from './services/config';
import type {
  CommentNextBadgeConfig,
  CommentNextComment,
} from './types/comment';
import { commentAnchor, getCommentAnchorHref } from './utils/comment-anchor';
import { formatRelativeTime } from './utils/date';
import {
  COMMENT_NEXT_UPVOTED_REPLIES_KEY,
  hasRememberedUpvote,
  rememberedUpvoteCount,
  rememberUpvote,
  rememberUpvoteCount,
} from './utils/upvote';
import { getCommentEnvironmentTags } from './utils/user-agent';

const {
  baseUrl = '',
  reply,
  badgeConfig = {},
  replyToName = '',
  demoData = false,
  showCommenterDevice = true,
  enableImageLightbox = true,
  aiMentionName = '',
  loggedIn = false,
  reactionConfig,
  reportConfig,
  emoteConfig,
  onReply = () => {},
}: {
  baseUrl?: string;
  reply: CommentNextComment;
  badgeConfig?: CommentNextBadgeConfig;
  replyToName?: string;
  demoData?: boolean;
  showCommenterDevice?: boolean;
  enableImageLightbox?: boolean;
  aiMentionName?: string;
  loggedIn?: boolean;
  reactionConfig?: CommentNextReactionConfig;
  reportConfig?: CommentNextReportConfig;
  emoteConfig?: CommentNextEmoteConfig;
  onReply?: (reply: CommentNextComment) => void;
} = $props();

let previousReplyId = $state('');
let upvoted = $state(false);
let upvotes = $state(0);

const badges = $derived(resolveCommentBadges(reply, { config: badgeConfig }));
const environmentTags = $derived(
  getCommentEnvironmentTags({
    userAgent: reply.userAgent,
  })
);
const replyReactionEnabled = $derived(
  Boolean(reactionConfig?.enabled && reactionConfig.replyEnabled !== false)
);

$effect(() => {
  if (previousReplyId !== reply.id) {
    previousReplyId = reply.id;
    const rememberedUpvote = hasRememberedUpvote(
      COMMENT_NEXT_UPVOTED_REPLIES_KEY,
      reply.id
    );
    upvoted = rememberedUpvote;
    upvotes = Math.max(
      reply.stats?.upvotes ?? 0,
      rememberedUpvoteCount(COMMENT_NEXT_UPVOTED_REPLIES_KEY, reply.id) ??
        (rememberedUpvote ? 1 : 0)
    );
  }
});

async function handleUpvote() {
  if (upvoted) {
    return;
  }

  upvoted = true;
  upvotes += 1;

  try {
    if (!demoData) {
      await upvoteCommentTarget({
        baseUrl,
        name: reply.id,
        plural: 'replies',
      });
    }
    rememberUpvote(COMMENT_NEXT_UPVOTED_REPLIES_KEY, reply.id);
    rememberUpvoteCount(COMMENT_NEXT_UPVOTED_REPLIES_KEY, reply.id, upvotes);
  } catch (error) {
    const rememberedUpvote = hasRememberedUpvote(
      COMMENT_NEXT_UPVOTED_REPLIES_KEY,
      reply.id
    );
    upvoted = rememberedUpvote;
    upvotes = Math.max(
      reply.stats?.upvotes ?? 0,
      rememberedUpvoteCount(COMMENT_NEXT_UPVOTED_REPLIES_KEY, reply.id) ??
        (rememberedUpvote ? 1 : 0)
    );
    console.warn('Failed to upvote reply', error);
  }
}
</script>

<article
  use:commentAnchor={{ kind: 'reply', id: reply.id }}
  class="comment-next-reply-item"
>
  <div class="comment-next-reply-avatar">
    <CommentNextAvatar src={reply.author.avatar} alt={reply.author.displayName} size={28} />
  </div>
  <div class="comment-next-reply-main">
    <header class="comment-next-reply-meta">
      <span class="comment-next-reply-author">{reply.author.displayName}</span>
      {#each badges as badge}
        <CommentNextBadge {badge} />
      {/each}
      {#if reply.top || reply.featured}
        <span class="comment-next-reply-flags" aria-label="回复状态">
          {#if reply.top}
            <span class="comment-next-reply-flag comment-next-reply-flag-pinned">
              <CommentNextIcon name="pin" size={11} />
              置顶
            </span>
          {/if}
          {#if reply.featured}
            <span class="comment-next-reply-flag comment-next-reply-flag-featured">
              <CommentNextIcon name="star" size={11} />
              精选
            </span>
          {/if}
        </span>
      {/if}
      {#if reply.approved === false}
        <span class="comment-next-reply-state">待审核</span>
      {/if}
      <span class="comment-next-reply-submeta">
        {#if reply.creationTime}
          <time>{formatRelativeTime(reply.creationTime)}</time>
        {/if}
        {#if showCommenterDevice}
          <CommentNextEnvironmentTags tags={environmentTags} compact />
        {/if}
        {#if replyToName}
          <span>回复 <strong>@{replyToName}</strong>：</span>
        {/if}
      </span>
    </header>

    <CommentNextContent
      content={reply.content}
      {aiMentionName}
      {enableImageLightbox}
      allowedLottieHosts={emoteConfig?.allowedHosts}
    />

    <div class="comment-next-reply-actions">
      {#if replyReactionEnabled}
        <CommentNextReactionButton
          {baseUrl}
          targetType="REPLY"
          name={reply.id}
          {loggedIn}
          config={reactionConfig}
          {demoData}
        />
      {:else}
        <button
          class:comment-next-reply-action-liked={upvoted}
          type="button"
          aria-label="点赞回复"
          onclick={handleUpvote}
        >
          <CommentNextIcon name={upvoted ? "heartFill" : "heart"} size={13} />
          {upvotes}
        </button>
      {/if}
      <button type="button" onclick={() => onReply(reply)}>
        <CommentNextIcon name="reply" size={13} />
        回复
      </button>
      <CommentNextReportButton
        {baseUrl}
        targetType="REPLY"
        name={reply.id}
        {loggedIn}
        config={reportConfig}
        {demoData}
        compact
      />
      <a
        class="comment-next-reply-anchor"
        href={getCommentAnchorHref('reply', reply.id)}
        aria-label="跳转到此回复"
        title="回复链接"
      >
        <CommentNextIcon name="link" size={13} />
        链接
      </a>
    </div>
  </div>
</article>

<style>
  .comment-next-reply-item {
    --at-apply: grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 px-0 pb-0 pt-3;
  }

  .comment-next-reply-avatar {
    --at-apply: w-[1.75rem] min-w-0 justify-self-start self-start pt-0.5 leading-none;
  }

  .comment-next-reply-main {
    --at-apply: min-w-0 border-b border-b-solid [border-bottom-color:var(--comment-next-border-subtle-color,#e7ecf2)] pb-3;
  }

  .comment-next-reply-item:last-child .comment-next-reply-main {
    --at-apply: border-b-0 pb-0;
  }

  .comment-next-reply-meta {
    --at-apply: mb-[0.4rem] flex min-h-[1.75rem] min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1;
  }

  .comment-next-reply-author {
    --at-apply: max-w-40 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[var(--comment-next-text-color,#172033)] font-[760] leading-[1.25rem];
  }

  .comment-next-reply-flags {
    --at-apply: inline-flex flex-wrap items-center gap-1;
  }

  .comment-next-reply-flag {
    --at-apply: inline-flex h-[1.125rem] items-center gap-0.5 rounded-full border border-solid px-1.5 text-[0.65rem] font-[760] leading-none;
  }

  .comment-next-reply-flag-pinned {
    --at-apply: [border-color:var(--comment-next-pinned-border-color,rgb(252_211_77))] bg-[var(--comment-next-pinned-pill-bg-color,rgb(254_243_199))] text-[var(--comment-next-pinned-text-color,rgb(146_64_14))];
  }

  .comment-next-reply-flag-featured {
    --at-apply: [border-color:var(--comment-next-featured-border-color,rgb(153_246_228))] bg-[var(--comment-next-featured-pill-bg-color,rgb(204_251_241))] text-[var(--comment-next-featured-text-color,rgb(15_118_110))];
  }

  .comment-next-reply-submeta,
  .comment-next-reply-state {
    --at-apply: text-xs text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-reply-submeta {
    --at-apply: inline-flex min-w-0 flex-wrap items-center gap-[0.45rem] font-[560] leading-[1.25rem];
  }

  .comment-next-reply-submeta strong {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))] font-[650];
  }

  .comment-next-reply-actions {
    --at-apply: mt-[0.45rem] flex gap-3;
  }

  .comment-next-reply-actions button,
  .comment-next-reply-anchor {
    --at-apply: inline-flex h-[1.375rem] cursor-pointer items-center gap-1 border-0 rounded-none bg-transparent p-0 text-xs text-[var(--comment-next-muted-color,#6b7687)] font-[650] font-inherit;
    text-decoration: none;
  }

  .comment-next-reply-actions button:hover,
  .comment-next-reply-anchor:hover {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-reply-actions .comment-next-reply-action-liked,
  .comment-next-reply-actions .comment-next-reply-action-liked:hover {
    --at-apply: text-[var(--comment-next-like-color,#ef4444)];
  }
</style>
