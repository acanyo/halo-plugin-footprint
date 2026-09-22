export interface CaptchaRequiredResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  captcha?: string;
  captchaType?: CommentNextCaptchaType;
}

export type CommentNextCaptchaType =
  | 'ALPHANUMERIC'
  | 'ARITHMETIC'
  | 'GEETEST'
  | 'ALTCHA'
  | 'CAP';

export interface CommentNextGeeTestCaptchaConfig {
  captchaId?: string;
  apiServer?: string;
}

export interface CommentNextAltchaCaptchaConfig {
  algorithm?: string;
  cost?: number;
  expiresInSeconds?: number;
}

export interface CommentNextCapCaptchaConfig {
  apiEndpoint?: string;
}

export interface CommentNextCaptchaConfig {
  anonymousCommentCaptcha?: boolean;
  type?: CommentNextCaptchaType;
  geeTest?: CommentNextGeeTestCaptchaConfig;
  altcha?: CommentNextAltchaCaptchaConfig;
  cap?: CommentNextCapCaptchaConfig;
}

const CAPTCHA_ENDPOINT =
  '/apis/api.commentnext.xhhao.com/v1alpha1/captcha/-/generate';
const ALTCHA_CHALLENGE_ENDPOINT =
  '/apis/api.commentnext.xhhao.com/v1alpha1/captcha/-/altcha-challenge';
const CAPTCHA_CODE_HEADER = 'X-Captcha-Code';
const CAPTCHA_REQUIRED_HEADER = 'X-Require-Captcha';

export function getCaptchaCodeHeader(code: string): Record<string, string> {
  const normalizedCode = code.trim();

  if (!normalizedCode) {
    return {};
  }

  return {
    [CAPTCHA_CODE_HEADER]: normalizedCode,
  };
}

export function isCaptchaRequired(response: Response): boolean {
  return (
    response.status === 403 && response.headers.has(CAPTCHA_REQUIRED_HEADER)
  );
}

export function isLocalImageCaptcha(type: CommentNextCaptchaType): boolean {
  return type === 'ALPHANUMERIC' || type === 'ARITHMETIC';
}

export async function fetchCaptchaImage(baseUrl = ''): Promise<string> {
  const response = await fetch(resolveApiUrl(baseUrl, CAPTCHA_ENDPOINT), {
    credentials: 'include',
    headers: {
      Accept: 'text/plain',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch captcha: ${response.status}`);
  }

  return response.text();
}

export function getAltchaChallengeUrl(baseUrl = ''): string {
  return resolveApiUrl(baseUrl, ALTCHA_CHALLENGE_ENDPOINT);
}

export function resolveApiUrl(baseUrl: string, endpoint: string): string {
  if (!baseUrl) {
    return endpoint;
  }

  return `${baseUrl.replace(/\/$/, '')}${endpoint}`;
}
