export const COMMENT_NEXT_UPVOTED_COMMENTS_KEY = 'halo.upvoted.comments';
export const COMMENT_NEXT_UPVOTED_REPLIES_KEY = 'halo.upvoted.replies';

const UPVOTE_COUNT_SUFFIX = '.counts';

export function hasRememberedUpvote(storageKey: string, id: string): boolean {
  return readRememberedUpvotes(storageKey).includes(id);
}

export function rememberUpvote(storageKey: string, id: string) {
  const items = readRememberedUpvotes(storageKey);

  if (items.includes(id)) {
    return;
  }

  localStorage.setItem(storageKey, JSON.stringify([...items, id]));
}

export function rememberUpvoteCount(
  storageKey: string,
  id: string,
  count: number
) {
  const counts = readRememberedUpvoteCounts(storageKey);
  counts[id] = Math.max(1, count);
  localStorage.setItem(countStorageKey(storageKey), JSON.stringify(counts));
}

export function rememberedUpvoteCount(
  storageKey: string,
  id: string
): number | undefined {
  return readRememberedUpvoteCounts(storageKey)[id];
}

function readRememberedUpvotes(storageKey: string): string[] {
  try {
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(items)
      ? items.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function readRememberedUpvoteCounts(storageKey: string): Record<string, number> {
  try {
    const counts = JSON.parse(
      localStorage.getItem(countStorageKey(storageKey)) || '{}'
    );

    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(counts)
        .filter((entry): entry is [string, number] => {
          const [id, count] = entry;
          return typeof id === 'string' && typeof count === 'number';
        })
        .map(([id, count]) => [id, Math.max(1, count)])
    );
  } catch {
    return {};
  }
}

function countStorageKey(storageKey: string): string {
  return `${storageKey}${UPVOTE_COUNT_SUFFIX}`;
}
