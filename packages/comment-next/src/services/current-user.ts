import { resolveApiUrl } from './api';

export interface CurrentUser {
  name: string;
  displayName: string;
  avatar?: string;
}

interface DetailedUserResponse {
  user?: {
    metadata?: {
      name?: string;
    };
    spec?: {
      displayName?: string;
      avatar?: string;
    };
  } | null;
  metadata?: {
    name?: string;
  };
  spec?: {
    displayName?: string;
    avatar?: string;
  };
}

const ANONYMOUS_USER_NAME = 'anonymousUser';
const CURRENT_USER_ENDPOINT =
  '/apis/api.console.halo.run/v1alpha1/users/-';

export async function fetchCurrentUser(
  baseUrl = ''
): Promise<CurrentUser | undefined> {
  return fetchCurrentUserFrom(baseUrl, CURRENT_USER_ENDPOINT).catch(
    () => undefined
  );
}

async function fetchCurrentUserFrom(
  baseUrl: string,
  endpoint: string
): Promise<CurrentUser | undefined> {
  const response = await fetch(resolveApiUrl(baseUrl, endpoint), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return undefined;
  }

  const data = (await response.json()) as DetailedUserResponse;
  const user = data.user ?? data;
  const name = user?.metadata?.name ?? '';

  if (!user || !name || name === ANONYMOUS_USER_NAME) {
    return undefined;
  }

  return {
    name,
    displayName: user.spec?.displayName || name,
    avatar: user.spec?.avatar,
  };
}
