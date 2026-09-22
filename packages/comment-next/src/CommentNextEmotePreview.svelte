<script lang="ts">
import CommentNextLottie from './CommentNextLottie.svelte';
import type { CommentNextEmoteItem } from './types/emote';

const {
  item,
  packName = '',
  style = '',
}: {
  item: CommentNextEmoteItem;
  packName?: string;
  style?: string;
} = $props();

const previewSrc = $derived(
  item.originSrc || item.src || item.previewSrc || ''
);
const previewLabel = $derived(item.description || item.label || packName);
const isLottie = $derived(item.type === 'lottie' && Boolean(item.contentUrl));
</script>

{#if previewSrc || isLottie}
  <div
    class:comment-next-emote-preview-lottie={isLottie}
    class="comment-next-emote-preview"
    role="status"
    aria-live="polite"
    style={style}
  >
    <div class="comment-next-emote-preview-image">
      {#if isLottie}
        <CommentNextLottie
          item={item}
          maxWidth={220}
          maxHeight={160}
          autoplay={true}
          hoverPlay={false}
          freezeOnOffscreen={false}
        />
      {:else}
        <img src={previewSrc} alt={previewLabel} decoding="async" />
      {/if}
    </div>
    {#if previewLabel}
      <span>{previewLabel}</span>
    {/if}
  </div>
{/if}

<style>
  .comment-next-emote-preview {
    --at-apply: pointer-events-none fixed z-[10000] flex w-34 flex-col items-center gap-1.5 rounded-[0.75rem] border border-solid [border-color:var(--comment-next-border-subtle-color,#dfe5ec)] bg-[var(--comment-next-tooltip-bg-color,rgb(255_255_255_/_0.96))] p-2 text-center text-[var(--comment-next-tooltip-text-color,#172033)] shadow-[var(--comment-next-tooltip-shadow,0_14px_30px_rgb(15_23_42_/_0.18))] backdrop-blur-md;
    left: var(--comment-next-emote-preview-left, 1rem);
    top: var(--comment-next-emote-preview-top, 1rem);
    animation: comment-next-emote-preview-in 120ms ease-out;
  }

  .comment-next-emote-preview-lottie {
    --at-apply: w-60;
  }

  .comment-next-emote-preview-image {
    --at-apply: flex h-30 w-full items-center justify-center overflow-hidden rounded-[0.5rem];
  }

  .comment-next-emote-preview-lottie .comment-next-emote-preview-image {
    --at-apply: h-40;
  }

  .comment-next-emote-preview img {
    --at-apply: block max-h-full max-w-full object-contain;
  }

  .comment-next-emote-preview span {
    --at-apply: block max-w-full truncate text-xs;
    font-weight: 650;
  }

  @keyframes comment-next-emote-preview-in {
    from {
      opacity: 0;
      transform: translateY(0.2rem) scale(0.97);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 780px), (hover: none) and (pointer: coarse) {
    .comment-next-emote-preview {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-emote-preview {
      animation: none;
    }
  }
</style>
