import type { CommentNextComposerOwner } from '../types/composer';

const STORAGE_KEY = 'comment-next-anonymous-account';
const LEGACY_STORAGE_KEY = 'halo-comment-custom-account';

export function loadAnonymousAccount(): CommentNextComposerOwner | undefined {
  const account =
    readStoredAccount(STORAGE_KEY) ?? readStoredAccount(LEGACY_STORAGE_KEY);

  if (!account) {
    return undefined;
  }

  saveAnonymousAccount(account);

  return account;
}

export function saveAnonymousAccount(account: CommentNextComposerOwner): void {
  const normalizedAccount = normalizeAnonymousAccount(account);

  if (!normalizedAccount) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedAccount));
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(normalizedAccount));
  } catch {
    // Ignore restricted storage environments.
  }
}

function readStoredAccount(
  storageKey: string
): CommentNextComposerOwner | undefined {
  try {
    const rawValue = localStorage.getItem(storageKey);

    if (!rawValue) {
      return undefined;
    }

    return normalizeAnonymousAccount(JSON.parse(rawValue));
  } catch {
    return undefined;
  }
}

function normalizeAnonymousAccount(
  value: unknown
): CommentNextComposerOwner | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const account = value as Partial<CommentNextComposerOwner>;
  const displayName = account.displayName?.trim();
  const email = account.email?.trim();
  const website = account.website?.trim();

  if (!displayName || !email) {
    return undefined;
  }

  return {
    displayName,
    email,
    website,
  };
}
