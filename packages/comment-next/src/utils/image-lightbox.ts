export type CommentNextLightboxImage = {
  src: string;
  alt: string;
};

type ImageLightboxOptions = {
  enabled: boolean;
  content: string;
  onOpen: (image: CommentNextLightboxImage) => void;
};

export function imageLightboxContent(
  node: HTMLElement,
  options: ImageLightboxOptions
) {
  let currentOptions = options;
  let updateFrame: number | undefined;

  const openFromTarget = (target: EventTarget | null): boolean => {
    if (!currentOptions.enabled || !(target instanceof HTMLImageElement)) {
      return false;
    }

    const src = target.currentSrc || target.src;

    if (!src) {
      return false;
    }

    currentOptions.onOpen({
      src,
      alt: target.alt.trim(),
    });
    return true;
  };

  const handleClick = (event: MouseEvent) => {
    if (openFromTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      openFromTarget(event.target)
    ) {
      event.preventDefault();
    }
  };

  const update = (nextOptions: ImageLightboxOptions) => {
    currentOptions = nextOptions;

    if (updateFrame !== undefined) {
      cancelAnimationFrame(updateFrame);
    }

    updateFrame = requestAnimationFrame(() => {
      updateFrame = undefined;
      updateImageAccessibility(node, currentOptions.enabled);
    });
  };

  node.addEventListener('click', handleClick);
  node.addEventListener('keydown', handleKeydown);
  update(options);

  return {
    update,
    destroy() {
      if (updateFrame !== undefined) {
        cancelAnimationFrame(updateFrame);
      }

      node.removeEventListener('click', handleClick);
      node.removeEventListener('keydown', handleKeydown);
    },
  };
}

function updateImageAccessibility(container: HTMLElement, enabled: boolean) {
  container.querySelectorAll('img').forEach((image) => {
    image.classList.toggle('comment-next-lightbox-trigger', enabled);

    if (enabled) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute(
        'aria-label',
        image.alt.trim() ? `预览图片：${image.alt.trim()}` : '预览图片'
      );
      return;
    }

    image.removeAttribute('tabindex');
    image.removeAttribute('role');
    image.removeAttribute('aria-label');
  });
}
