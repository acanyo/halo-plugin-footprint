export type CommentAnchorKind = 'comment' | 'reply';

type CommentAnchorOptions = {
  kind: CommentAnchorKind;
  id: string;
};

export function getCommentAnchorId(
  kind: CommentAnchorKind,
  id: string
): string {
  return `comment-next-${kind}-${id}`;
}

export function getCommentAnchorHref(
  kind: CommentAnchorKind,
  id: string
): string {
  return `#${encodeURIComponent(getCommentAnchorId(kind, id))}`;
}

export function commentAnchor(
  node: HTMLElement,
  options: CommentAnchorOptions
) {
  let currentOptions = options;

  function scrollToAnchor() {
    if (currentHashAnchor() !== node.id) {
      return;
    }

    requestAnimationFrame(() => {
      node.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }

  function applyAnchor() {
    node.id = getCommentAnchorId(currentOptions.kind, currentOptions.id);
    node.style.scrollMarginTop = 'var(--comment-next-anchor-offset, 5rem)';
    scrollToAnchor();
  }

  window.addEventListener('hashchange', scrollToAnchor);
  applyAnchor();

  return {
    update(nextOptions: CommentAnchorOptions) {
      currentOptions = nextOptions;
      applyAnchor();
    },
    destroy() {
      window.removeEventListener('hashchange', scrollToAnchor);
    },
  };
}

function currentHashAnchor(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return window.location.hash.slice(1);
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
