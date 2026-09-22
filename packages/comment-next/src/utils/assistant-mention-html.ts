export function highlightAssistantMentionHtml(
  value: string,
  mentionName = ''
): string {
  const normalizedMention = normalizeMentionName(mentionName);

  if (!value || !normalizedMention || typeof document === 'undefined') {
    return value;
  }

  const template = document.createElement('template');
  template.innerHTML = value;
  highlightMentionTextNodes(template.content, normalizedMention);
  return template.innerHTML;
}

function highlightMentionTextNodes(
  parent: ParentNode,
  mentionName: string
): void {
  const textNodes: Text[] = [];
  const mentionNameLower = mentionName.toLowerCase();
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? '';
      const parentElement = node.parentElement;

      if (
        !text.toLowerCase().includes(mentionNameLower) ||
        parentElement?.closest('a, code, pre, .comment-next-ai-mention')
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const fragment = createMentionHighlightedFragment(
      textNode.textContent ?? '',
      mentionName,
      mentionNameLower
    );
    if (fragment) {
      textNode.replaceWith(fragment);
    }
  }
}

function createMentionHighlightedFragment(
  text: string,
  mentionName: string,
  mentionNameLower: string
): DocumentFragment | undefined {
  const textLower = text.toLowerCase();
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let index = textLower.indexOf(mentionNameLower);
  let matched = false;

  while (index >= 0) {
    fragment.append(text.slice(cursor, index));
    fragment.append(
      createMentionElement(text.slice(index, index + mentionName.length))
    );
    cursor = index + mentionName.length;
    index = textLower.indexOf(mentionNameLower, cursor);
    matched = true;
  }

  if (!matched) {
    return undefined;
  }

  fragment.append(text.slice(cursor));
  return fragment;
}

function createMentionElement(text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = 'comment-next-ai-mention';
  element.setAttribute('data-comment-next-ai-mention', 'true');
  element.textContent = text;
  return element;
}

function normalizeMentionName(value: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return '';
  }
  return normalizedValue.startsWith('@')
    ? normalizedValue
    : `@${normalizedValue}`;
}
