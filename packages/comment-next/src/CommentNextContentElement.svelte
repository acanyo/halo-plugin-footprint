<svelte:options
  customElement={{
    tag: "comment-next-content",
    props: {
      content: { reflect: true, type: "String", attribute: "content" },
      allowImages: { reflect: true, type: "Boolean", attribute: "allow-images" },
      enableImageLightbox: { reflect: true, type: "Boolean", attribute: "enable-image-lightbox" },
      allowedLottieHosts: { type: "Array" },
    },
  }}
/>

<script lang="ts">
import CommentNextContent from './CommentNextContent.svelte';

const {
  content = '',
  allowImages = true,
  enableImageLightbox = true,
  allowedLottieHosts = [],
}: {
  content?: string;
  allowImages?: boolean;
  enableImageLightbox?: boolean;
  allowedLottieHosts?: Array<{ host?: string }>;
} = $props();
</script>

<CommentNextContent
  {content}
  {allowImages}
  {enableImageLightbox}
  {allowedLottieHosts}
/>

<style>
  :host {
    display: block;
    min-width: 0;
    max-width: 100%;
    width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
