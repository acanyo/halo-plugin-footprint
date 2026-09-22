<script lang="ts">
const widths = ['68%', '52%', '78%'];
</script>

<div class="comment-next-comment-skeleton" aria-busy="true" aria-label="评论列表加载中">
  {#each widths as width}
    <div class="comment-next-comment-skeleton-row">
      <span class="comment-next-comment-skeleton-avatar"></span>
      <span class="comment-next-comment-skeleton-body">
        <span class="comment-next-comment-skeleton-meta" style={`width: ${width}`}></span>
        <span class="comment-next-comment-skeleton-line"></span>
        <span class="comment-next-comment-skeleton-line comment-next-comment-skeleton-line-short"></span>
      </span>
    </div>
  {/each}
</div>

<style>
  .comment-next-comment-skeleton {
    --at-apply: grid gap-3.5 pt-4;
  }

  .comment-next-comment-skeleton-row {
    --at-apply: grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3;
  }

  .comment-next-comment-skeleton-avatar,
  .comment-next-comment-skeleton-meta,
  .comment-next-comment-skeleton-line {
    --at-apply: relative block overflow-hidden bg-[var(--comment-next-skeleton-base-color,#edf2f5)];
  }

  .comment-next-comment-skeleton-avatar::after,
  .comment-next-comment-skeleton-meta::after,
  .comment-next-comment-skeleton-line::after {
    --at-apply: absolute inset-0 [background:linear-gradient(90deg,transparent,var(--comment-next-skeleton-highlight-color,rgb(255_255_255_/_0.78)),transparent)] -translate-x-full;
    content: "";
    animation: comment-next-comment-skeleton-shimmer 1.35s ease-in-out infinite;
  }

  .comment-next-comment-skeleton-avatar {
    --at-apply: h-9 w-9 rounded-full;
  }

  .comment-next-comment-skeleton-body {
    --at-apply: grid gap-2 pt-0.5;
  }

  .comment-next-comment-skeleton-meta {
    --at-apply: h-3.5 rounded-full;
  }

  .comment-next-comment-skeleton-line {
    --at-apply: h-3 w-full rounded-full;
  }

  .comment-next-comment-skeleton-line-short {
    --at-apply: w-[42%];
  }

  @keyframes comment-next-comment-skeleton-shimmer {
    to {
      transform: translateX(100%);
    }
  }
</style>
