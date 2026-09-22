import type { CommentNextRawEmotePacks } from '../types/emote';

const EMOTES_ENDPOINT = '/apis/api.commentnext.xhhao.com/v1alpha1/emotes';

export async function fetchEmotePacks(
  baseUrl = ''
): Promise<CommentNextRawEmotePacks> {
  const response = await fetch(resolveApiUrl(baseUrl, EMOTES_ENDPOINT), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch comment next emotes: ${response.status}`);
  }

  return response.json() as Promise<CommentNextRawEmotePacks>;
}

function resolveApiUrl(baseUrl: string, endpoint: string): string {
  if (!baseUrl) {
    return endpoint;
  }

  return `${baseUrl.replace(/\/$/, '')}${endpoint}`;
}
