<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';

const {
  src = '',
  alt = '',
  size = 36,
}: {
  src?: string;
  alt?: string;
  size?: number;
} = $props();

let failed = $state(false);
let previousSrc = $state('');
const placeholderText = $derived(getPlaceholderText(alt));

$effect(() => {
  if (previousSrc !== src) {
    previousSrc = src;
    failed = false;
  }
});

function getPlaceholderText(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  const words = trimmedValue.split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }

  return trimmedValue.charAt(0).toUpperCase();
}
</script>

<span
  class="comment-next-avatar inline-flex items-center justify-center flex-none overflow-hidden border border-solid [border-color:var(--comment-next-avatar-border-color,rgb(15_23_42_/_0.08))] [background:linear-gradient(180deg,rgb(255_255_255_/_0.88),rgb(238_244_244_/_0.9)),var(--comment-next-field-bg-color,#fbfcfd)] text-[var(--comment-next-muted-color,#6b7687)] shadow-[0_1px_2px_rgb(15_23_42_/_0.06)]"
  style={`--comment-next-avatar-instance-size: ${size}px`}
  aria-label={alt || "头像"}
>
  {#if src && !failed}
    <img
      class="comment-next-avatar-image block object-cover"
      {src}
      {alt}
      loading="lazy"
      decoding="async"
      onerror={() => (failed = true)}
    />
  {:else if placeholderText}
    <span class="comment-next-avatar-placeholder select-none text-[0.8125rem] text-[var(--comment-next-text-color,#172033)] font-[760] leading-none">{placeholderText}</span>
  {:else}
    <CommentNextIcon name="user" size={Math.round(size * 0.46)} />
  {/if}
</span>

<style>
  .comment-next-avatar {
    --comment-next-avatar-effective-size: var(
      --comment-next-avatar-instance-size,
      var(--comment-next-avatar-size, var(--halo-cw-avatar-size, 36px))
    );
    box-sizing: border-box;
    flex: 0 0 var(--comment-next-avatar-effective-size);
    width: var(
      --comment-next-avatar-effective-size
    );
    height: var(
      --comment-next-avatar-effective-size
    );
    min-width: var(--comment-next-avatar-effective-size);
    min-height: var(--comment-next-avatar-effective-size);
    max-width: var(--comment-next-avatar-effective-size);
    max-height: var(--comment-next-avatar-effective-size);
    aspect-ratio: 1 / 1;
    border-radius: var(--comment-next-avatar-rounded, var(--halo-cw-avatar-rounded, 9999px));
  }

  .comment-next-avatar-image {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 100%;
    min-height: 100%;
    max-width: 100%;
    max-height: 100%;
    flex: 0 0 100%;
    aspect-ratio: 1 / 1;
    border-radius: inherit;
  }
</style>
