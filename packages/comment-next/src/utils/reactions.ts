import type { CommentNextReactionOption } from '../services/config';
import type { CommentNextReactionItem } from '../services/reactions';

export const FALLBACK_REACTION_ITEMS: CommentNextReactionItem[] = [
  { name: 'like', type: 'EMOJI', value: '👍', label: '点赞', count: 0, selected: false },
  { name: 'dislike', type: 'EMOJI', value: '👎', label: '踩', count: 0, selected: false },
  { name: 'happy', type: 'EMOJI', value: '😄', label: '开心', count: 0, selected: false },
  { name: 'celebrate', type: 'EMOJI', value: '🎉', label: '庆祝', count: 0, selected: false },
  { name: 'love', type: 'EMOJI', value: '💗', label: '喜欢', count: 0, selected: false },
  { name: 'confused', type: 'EMOJI', value: '😳', label: '困惑', count: 0, selected: false },
];

export function resolveConfiguredReactionItems(
  configuredItems?: CommentNextReactionOption[]
): CommentNextReactionItem[] {
  const options: CommentNextReactionItem[] = [];

  configuredItems?.forEach((item, index) => {
    const value = item.value?.trim();
    if (!value) {
      return;
    }

    const label = item.label?.trim() || value;
    options.push({
      name: normalizeReactionName(item.name || label, index),
      type: item.type === 'IMAGE' ? 'IMAGE' : 'EMOJI',
      value,
      label,
      count: 0,
      selected: false,
    });
  });

  return options.length ? options : FALLBACK_REACTION_ITEMS;
}

export function getReactionTotalCount(items: CommentNextReactionItem[]) {
  return items.reduce((total, item) => total + item.count, 0);
}

export function getVisibleReactionSummaryItems(
  items: CommentNextReactionItem[],
  limit = 3
) {
  return items.filter((item) => item.count > 0).slice(0, limit);
}

function normalizeReactionName(value: string, index: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return normalized || `reaction-${index + 1}`;
}
