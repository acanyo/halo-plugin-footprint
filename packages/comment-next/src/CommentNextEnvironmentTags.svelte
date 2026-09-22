<script lang="ts">
import type { CommentNextEnvironmentTag } from './utils/user-agent';

const {
  tags = [],
  compact = false,
}: {
  tags?: CommentNextEnvironmentTag[];
  compact?: boolean;
} = $props();
</script>

{#if tags.length}
  <span
    class:gap-[0.3rem]={compact}
    class="comment-next-env-tags inline-flex min-w-0 flex-wrap items-center gap-[0.35rem]"
    aria-label="评论环境"
  >
    {#each tags as tag}
      <span
        class="comment-next-env-tag inline-flex min-h-[1.375rem] max-w-48 box-border items-center gap-1 border-0 bg-transparent p-0 text-xs text-[var(--comment-next-muted-color,#6b7687)] font-[560] leading-none"
      >
        <span class="comment-next-env-tag-icon inline-flex text-inherit" style:color={tag.color}>
          <i class={`comment-next-env-icon inline-block h-[1em] w-[1em] text-[0.8125rem] ${compact ? "text-xs" : ""} ${tag.iconClass}`} aria-hidden="true"></i>
        </span>
        <span class="comment-next-env-tag-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{tag.label}</span>
      </span>
    {/each}
  </span>
{/if}

<style uno-safelist></style>
