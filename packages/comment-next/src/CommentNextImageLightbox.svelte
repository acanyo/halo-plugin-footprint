<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';
import { portalToBody } from './utils/portal';

const {
  src,
  alt = '',
  onClose = () => {},
}: {
  src: string;
  alt?: string;
  onClose?: () => void;
} = $props();

// biome-ignore lint/style/useConst: Svelte assigns this through bind:this.
let dialogElement = $state<HTMLDialogElement | null>(null);

$effect(() => {
  const element = dialogElement;

  if (element && !element.open) {
    element.showModal();
  }
});

function close() {
  onClose();
}

function handleDialogClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    close();
  }
}

function handleDialogCancel(event: Event) {
  event.preventDefault();
  close();
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  close();
}
</script>

<dialog
  use:portalToBody
  bind:this={dialogElement}
  class="comment-next-image-lightbox-shell"
  aria-label={alt ? `图片预览：${alt}` : '图片预览'}
  onclick={handleDialogClick}
  oncancel={handleDialogCancel}
  onkeydown={handleDialogKeydown}
  onclose={close}
>
  <button
    class="comment-next-image-lightbox-close"
    type="button"
    aria-label="关闭图片预览"
    onclick={close}
  >
    <CommentNextIcon name="x" size={22} />
  </button>

  <button
    class="comment-next-image-lightbox-stage"
    type="button"
    aria-label="关闭图片预览"
    onclick={close}
  >
    <img src={src} {alt} decoding="async" />
    {#if alt}
      <span class="comment-next-image-lightbox-caption">{alt}</span>
    {/if}
  </button>
</dialog>
