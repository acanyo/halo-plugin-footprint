import { resolveApiUrl } from './api';

const QQ_PROFILE_ENDPOINT =
  '/apis/api.commentnext.xhhao.com/v1alpha1/qq-profiles';
const QQ_EMAIL_PATTERN = /^[1-9][0-9]{4,11}@qq\.com$/i;

interface CommentNextQqProfileResponse {
  nickname?: string;
}

export function isQqEmail(value: string): boolean {
  return QQ_EMAIL_PATTERN.test(value.trim());
}

export async function fetchQqProfile(
  baseUrl: string,
  email: string
): Promise<CommentNextQqProfileResponse | undefined> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isQqEmail(normalizedEmail)) {
    return undefined;
  }

  const endpoint = resolveApiUrl(baseUrl, QQ_PROFILE_ENDPOINT);
  const response = await fetch(
    `${endpoint}?email=${encodeURIComponent(normalizedEmail)}`,
    {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    return undefined;
  }

  const profile = (await response.json()) as CommentNextQqProfileResponse;
  const nickname = profile.nickname?.trim();
  return nickname ? { nickname } : undefined;
}
