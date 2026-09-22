export const COMMENT_NEXT_MODAL_OPEN_EVENT = 'comment-next:modal-open';

export function notifyCommentNextModalOpen(source: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(COMMENT_NEXT_MODAL_OPEN_EVENT, {
      detail: { source },
    })
  );
}
