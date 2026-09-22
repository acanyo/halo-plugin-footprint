const AUTO_LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const TRAILING_PUNCTUATION_PATTERN = /[),.;:!?，。；：！？）]+$/;
const SKIPPED_PARENT_SELECTOR =
  "a, button, input, textarea, select, img, halo-lottie, [contenteditable='false']";

export function autolinkUrls(root: HTMLElement): boolean {
  const textNodes = collectLinkableTextNodes(root);
  let changed = false;

  for (const textNode of textNodes) {
    const replacement = createLinkedFragment(textNode);

    if (replacement) {
      textNode.replaceWith(replacement);
      changed = true;
    }
  }

  return changed;
}

export function getTextSelectionOffset(root: HTMLElement): number | undefined {
  const selection = getSelectionForRoot(root);

  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);

  if (!root.contains(range.startContainer)) {
    return undefined;
  }

  const beforeSelection = range.cloneRange();
  beforeSelection.selectNodeContents(root);
  beforeSelection.setEnd(range.startContainer, range.startOffset);

  return beforeSelection.toString().length;
}

export function restoreTextSelectionOffset(
  root: HTMLElement,
  offset: number
): void {
  const range = document.createRange();
  const selection = getSelectionForRoot(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const nodeTextLength = currentNode.textContent?.length ?? 0;
    const nextOffset = currentOffset + nodeTextLength;

    if (offset <= nextOffset) {
      range.setStart(currentNode, Math.max(0, offset - currentOffset));
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    currentOffset = nextOffset;
    currentNode = walker.nextNode();
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function getSelectionForRoot(root: HTMLElement): Selection | null {
  const rootNode = root.getRootNode();
  const selectionHost = rootNode as { getSelection?: () => Selection | null };
  const rootSelection = selectionHost.getSelection?.();

  return rootSelection ?? window.getSelection();
}

function collectLinkableTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? '';
      const parent = node.parentElement;

      AUTO_LINK_PATTERN.lastIndex = 0;

      if (
        !parent ||
        !AUTO_LINK_PATTERN.test(text) ||
        parent.closest(SKIPPED_PARENT_SELECTOR)
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let currentNode = walker.nextNode();

  while (currentNode) {
    nodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  return nodes;
}

function createLinkedFragment(textNode: Text): DocumentFragment | undefined {
  const text = textNode.textContent ?? '';
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let hasMatch = false;

  AUTO_LINK_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(AUTO_LINK_PATTERN)) {
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    const trailingPunctuation =
      matchText.match(TRAILING_PUNCTUATION_PATTERN)?.[0] ?? '';
    const visibleUrl = trailingPunctuation
      ? matchText.slice(0, -trailingPunctuation.length)
      : matchText;

    if (!visibleUrl) {
      continue;
    }

    fragment.append(text.slice(lastIndex, matchIndex));
    fragment.append(createAnchor(visibleUrl));

    if (trailingPunctuation) {
      fragment.append(trailingPunctuation);
    }

    lastIndex = matchIndex + matchText.length;
    hasMatch = true;
  }

  if (!hasMatch) {
    return undefined;
  }

  fragment.append(text.slice(lastIndex));

  return fragment;
}

function createAnchor(url: string): HTMLAnchorElement {
  const anchor = document.createElement('a');

  anchor.className = 'comment-next-auto-link';
  anchor.href = url.startsWith('www.') ? `https://${url}` : url;
  anchor.rel = 'nofollow noopener noreferrer';
  anchor.target = '_blank';
  anchor.textContent = url;

  return anchor;
}
