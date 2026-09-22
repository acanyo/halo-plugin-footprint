<script lang="ts">
import type { Snippet } from 'svelte';

const {
  text = '',
  placement = 'top',
  align = 'center',
  mobileAlign,
  disabled = false,
  children,
}: {
  text?: string;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  mobileAlign?: 'start' | 'center' | 'end';
  disabled?: boolean;
  children?: Snippet;
} = $props();

const tooltipText = $derived(text.trim());
const enabled = $derived(Boolean(tooltipText) && !disabled);
</script>

<span
  class:comment-next-tooltip-bottom={placement === 'bottom'}
  class:comment-next-tooltip-start={align === 'start'}
  class:comment-next-tooltip-end={align === 'end'}
  class:comment-next-tooltip-mobile-start={mobileAlign === 'start'}
  class:comment-next-tooltip-mobile-center={mobileAlign === 'center'}
  class:comment-next-tooltip-mobile-end={mobileAlign === 'end'}
  class:comment-next-tooltip-disabled={!enabled}
  class="comment-next-tooltip"
  aria-label={enabled ? tooltipText : undefined}
>
  {@render children?.()}
  {#if enabled}
    <span class="comment-next-tooltip-content" role="tooltip">{tooltipText}</span>
  {/if}
</span>

<style>
  .comment-next-tooltip {
    --at-apply: relative inline-flex min-w-0 items-center align-middle;
  }

  .comment-next-tooltip-content {
    --at-apply: pointer-events-none absolute left-1/2 bottom-[calc(100%+0.25rem)] z-30 w-max max-w-56 origin-bottom -translate-x-1/2 translate-y-1 scale-95 rounded-md border border-solid [border-color:var(--comment-next-tooltip-border-color,rgb(226_232_240))] bg-[var(--comment-next-tooltip-bg-color,rgb(255_255_255_/_0.96))] px-2 py-1 text-left text-[0.75rem] text-[var(--comment-next-tooltip-text-color,#172033)] font-[560] leading-[1.45] opacity-0 shadow-[var(--comment-next-tooltip-shadow,0_8px_18px_rgb(15_23_42_/_0.10))] backdrop-blur-md transition-[opacity,transform] duration-120 ease-out;
  }

  .comment-next-tooltip-bottom .comment-next-tooltip-content {
    --at-apply: top-[calc(100%+0.25rem)] bottom-auto origin-top translate-y-[-0.25rem];
  }

  .comment-next-tooltip-start .comment-next-tooltip-content {
    --at-apply: left-0 translate-x-0;
  }

  .comment-next-tooltip-end .comment-next-tooltip-content {
    --at-apply: right-0 left-auto translate-x-0;
  }

  .comment-next-tooltip:not(.comment-next-tooltip-disabled):hover .comment-next-tooltip-content,
  .comment-next-tooltip:not(.comment-next-tooltip-disabled):focus-within .comment-next-tooltip-content {
    --at-apply: translate-y-0 scale-100 opacity-100;
  }

  @media (max-width: 640px) {
    .comment-next-tooltip-content {
      --at-apply: max-w-48 overflow-hidden text-ellipsis;
    }

    .comment-next-tooltip-mobile-start .comment-next-tooltip-content {
      --at-apply: left-0 right-auto translate-x-0;
    }

    .comment-next-tooltip-mobile-center .comment-next-tooltip-content {
      --at-apply: left-1/2 right-auto -translate-x-1/2;
    }

    .comment-next-tooltip-mobile-end .comment-next-tooltip-content {
      --at-apply: right-0 left-auto translate-x-0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-tooltip-content {
      --at-apply: transition-none;
    }
  }
</style>
