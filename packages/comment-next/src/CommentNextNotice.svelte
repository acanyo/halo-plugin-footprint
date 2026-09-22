<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';

type CommentNextNoticeVariant = 'error' | 'success' | 'info';

const {
  message = '',
  variant = 'info',
  compact = false,
}: {
  message?: string;
  variant?: CommentNextNoticeVariant;
  compact?: boolean;
} = $props();

const iconName = $derived(
  variant === 'success'
    ? 'circleCheck'
    : variant === 'info'
      ? 'loader'
      : 'circleAlert'
);
const role = $derived(variant === 'error' ? 'alert' : 'status');
</script>

{#if message}
  <section
    class:comment-next-notice-compact={compact}
    class:comment-next-notice-error={variant === "error"}
    class:comment-next-notice-success={variant === "success"}
    class:comment-next-notice-info={variant === "info"}
    class="comment-next-notice"
    {role}
    aria-live="polite"
  >
    <span class="comment-next-notice-icon" aria-hidden="true">
      <CommentNextIcon name={iconName} size={15} />
    </span>
    <span class="comment-next-notice-copy">{message}</span>
  </section>
{/if}

<style>
  .comment-next-notice {
    --comment-next-notice-color: var(--comment-next-muted-color,#667085);
    --comment-next-notice-bg: rgb(248 250 252 / 0.72);
    --comment-next-notice-border: var(--comment-next-divider-color,#d4dde8);
    --comment-next-notice-icon-bg: rgb(148 163 184 / 0.12);
    --at-apply: m-0 flex min-h-10 box-border items-center gap-2 border-t [border-top-style:var(--comment-next-divider-style,dashed)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--comment-next-notice-color)] font-[650] leading-snug [background:var(--comment-next-notice-bg)] [border-top-color:var(--comment-next-notice-border)];
  }

  .comment-next-notice-icon {
    --at-apply: inline-flex h-6 w-6 flex-none items-center justify-center rounded-md bg-[var(--comment-next-notice-icon-bg)] text-[var(--comment-next-notice-color)];
  }

  .comment-next-notice-copy {
    --at-apply: min-w-0 flex-1;
  }

  .comment-next-notice-error {
    --comment-next-notice-color: var(--comment-next-error-color,#dc2626);
    --comment-next-notice-bg: var(--comment-next-error-bg-color,rgb(254 242 242 / 0.72));
    --comment-next-notice-border: var(--comment-next-error-border-color,rgb(254 202 202 / 0.72));
    --comment-next-notice-icon-bg: rgb(220 38 38 / 0.08);
  }

  .comment-next-notice-success {
    --comment-next-notice-color: var(--comment-next-success-color,#15803d);
    --comment-next-notice-bg: var(--comment-next-success-bg-color,rgb(240 253 244 / 0.72));
    --comment-next-notice-border: var(--comment-next-success-border-color,rgb(187 247 208 / 0.76));
    --comment-next-notice-icon-bg: rgb(22 163 74 / 0.09);
  }

  .comment-next-notice-info {
    --comment-next-notice-color: var(--comment-next-info-color,#2563eb);
    --comment-next-notice-bg: var(--comment-next-info-bg-color,rgb(239 246 255 / 0.68));
    --comment-next-notice-border: var(--comment-next-info-border-color,rgb(191 219 254 / 0.68));
    --comment-next-notice-icon-bg: rgb(37 99 235 / 0.08);
  }

  .comment-next-notice-info .comment-next-notice-icon :global(.comment-next-icon) {
    --at-apply: animate-spin;
  }

  .comment-next-notice-compact {
    --at-apply: min-h-9 px-3 py-2 text-xs;
  }

  .comment-next-notice-compact .comment-next-notice-icon {
    --at-apply: h-5.5 w-5.5;
  }

  @media (max-width: 640px) {
    .comment-next-notice {
      --at-apply: items-start px-3 py-2.5;
    }
  }
</style>
