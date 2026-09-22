<script lang="ts">
import CommentNextImageLightbox from './CommentNextImageLightbox.svelte';
import type { CommentNextEmoteConfig } from './services/config';
import { highlightAssistantMentionHtml } from './utils/assistant-mention-html';
import { sanitizeCommentHtml, sanitizeConsoleCommentHtml } from './utils/html';
import {
  type CommentNextLightboxImage,
  imageLightboxContent,
} from './utils/image-lightbox';
import { ensureLottieRuntimeLoaded } from './utils/lottie-content-adapter';
import { upgradeLottieImages } from './utils/lottie-html';
import { notifyCommentNextModalOpen } from './utils/overlays';

const {
  content = '',
  allowImages = true,
  aiMentionName = '',
  enableImageLightbox = true,
  allowedLottieHosts = [],
}: {
  content?: string;
  allowImages?: boolean;
  aiMentionName?: string;
  enableImageLightbox?: boolean;
  allowedLottieHosts?: CommentNextEmoteConfig['allowedHosts'];
} = $props();

let lightboxImage = $state<CommentNextLightboxImage | undefined>();
let contentElement = $state<HTMLDivElement | undefined>();

const safeContent = $derived(
  highlightAssistantMentionHtml(
    allowImages
      ? sanitizeCommentHtml(content, allowedLottieHosts)
      : sanitizeConsoleCommentHtml(content, allowedLottieHosts),
    aiMentionName
  )
);

$effect(() => {
  const content = safeContent;
  const hosts = allowedLottieHosts;

  if (content.includes('<halo-lottie')) {
    ensureLottieRuntimeLoaded();
  }

  // Some consumers (notably the Console extension point) set the custom
  // element properties after the initial render. Scan the rendered DOM once
  // more so a stored Halo-safe Lottie <img> cannot remain unconverted.
  if (!contentElement || !content.includes('<img')) {
    return;
  }

  if (upgradeLottieImages(contentElement, hosts)) {
    ensureLottieRuntimeLoaded();
  }
});

function openLightbox(image: CommentNextLightboxImage) {
  notifyCommentNextModalOpen('image-lightbox');
  lightboxImage = image;
}
</script>

<div
  bind:this={contentElement}
  use:imageLightboxContent={{
    enabled: enableImageLightbox && allowImages,
    content: safeContent,
    onOpen: openLightbox,
  }}
  class="comment-next-comment-content break-words text-[0.9375rem] text-[var(--comment-next-comment-content-color,var(--comment-next-text-color,#172033))] leading-[1.72]"
>
  {@html safeContent}
</div>

{#if lightboxImage}
  <CommentNextImageLightbox
    src={lightboxImage.src}
    alt={lightboxImage.alt}
    onClose={() => (lightboxImage = undefined)}
  />
{/if}

<style>
  .comment-next-comment-content :global(p) {
    --at-apply: m-0;
  }

  .comment-next-comment-content {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .comment-next-comment-content :global(*) {
    max-width: 100%;
  }

  .comment-next-comment-content :global(a),
  .comment-next-comment-content :global(code),
  .comment-next-comment-content :global(span) {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-next-comment-content :global(p + p),
  .comment-next-comment-content :global(ul),
  .comment-next-comment-content :global(ol),
  .comment-next-comment-content :global(blockquote),
  .comment-next-comment-content :global(pre) {
    --at-apply: mt-2.5;
  }

  .comment-next-comment-content :global(a) {
    --at-apply: text-[var(--comment-next-link-color,rgb(59,130,246))] font-[620] decoration-[var(--comment-next-link-underline-color,rgb(59_130_246_/_0.35))] underline-offset-[0.18em];
  }

  .comment-next-comment-content :global(blockquote) {
    --at-apply: mx-0 py-1 pl-3.5 pr-0 border-l-3 border-l-solid [border-left-color:var(--comment-next-border-subtle-color,#dfe5ec)] text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-comment-content :global(code) {
    --at-apply: rounded px-[0.28rem] py-[0.08rem] bg-[var(--comment-next-inline-code-bg-color,#eef2f4)] text-[0.88em] text-[var(--comment-next-text-color,#172033)] font-mono;
    white-space: break-spaces;
  }

  .comment-next-comment-content :global(pre) {
    --at-apply: overflow-x-auto rounded-lg bg-[var(--comment-next-code-bg-color,#111827)] p-3 text-[#f9fafb];
    max-width: 100%;
    white-space: pre;
    word-break: normal;
  }

  .comment-next-comment-content :global(pre code) {
    --at-apply: bg-transparent p-0 text-inherit;
    white-space: pre;
    word-break: normal;
  }

  .comment-next-comment-content :global(.comment-next-emote-image) {
    --at-apply: mx-0.5 inline-block max-h-18 max-w-36 align-middle object-contain;
  }

  .comment-next-comment-content :global(.comment-next-image) {
    --at-apply: inline-block max-w-full align-middle object-contain;
  }

  .comment-next-comment-content :global(halo-lottie) {
    --at-apply: mx-0.5 inline-flex align-middle;
    max-width: 100%;
  }

  .comment-next-comment-content :global(.comment-next-lightbox-trigger) {
    cursor: zoom-in;
  }

  .comment-next-comment-content :global(.comment-next-lightbox-trigger:focus-visible) {
    outline: 2px solid var(--comment-next-primary-color, rgb(59, 130, 246));
    outline-offset: 3px;
  }

  .comment-next-comment-content :global(.comment-next-ai-mention) {
    --at-apply: mx-0.5 inline-flex translate-y-[-0.04em] items-center rounded-md border border-solid [border-color:var(--comment-next-ai-border-color,rgb(191_219_254))] bg-[var(--comment-next-ai-bg-color,rgb(239_246_255))] px-1.5 py-0.5 text-[0.88em] text-[var(--comment-next-ai-color,rgb(59,130,246))] font-[760] leading-none;
  }
</style>
