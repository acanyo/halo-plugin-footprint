import {
  hasChineseText,
  readProblemDetail,
  resolveApiUrl,
} from './api';

const AI_SUGGESTION_ENDPOINT =
  '/apis/api.commentnext.xhhao.com/v1alpha1/ai/-/suggestions';

export type CommentNextAiMode =
  | 'polish'
  | 'expand'
  | 'question'
  | 'reply'
  | 'summary';

export interface GenerateCommentAiSuggestionOptions {
  baseUrl?: string;
  mode: CommentNextAiMode | string;
  content: string;
  variant: 'comment' | 'reply';
  subject?: string;
  replyToName?: string;
}

export interface CommentNextAiSuggestionResult {
  text: string;
}

export class CommentNextAiError extends Error {
  status: number;
  title?: string;
  detail?: string;

  constructor({
    status,
    title,
    detail,
  }: {
    status: number;
    title?: string;
    detail?: string;
  }) {
    super(detail || title || `Failed to generate AI suggestion: ${status}`);
    this.name = 'CommentNextAiError';
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

export async function generateCommentAiSuggestion({
  baseUrl = '',
  mode,
  content,
  variant,
  subject,
  replyToName,
}: GenerateCommentAiSuggestionOptions): Promise<CommentNextAiSuggestionResult> {
  const response = await fetch(resolveApiUrl(baseUrl, AI_SUGGESTION_ENDPOINT), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode,
      content,
      variant,
      subject,
      replyToName,
    }),
  });

  if (!response.ok) {
    const problem = await readProblemDetail(response);
    throw new CommentNextAiError({
      status: response.status,
      title: problem?.title,
      detail: problem?.detail,
    });
  }

  return response.json() as Promise<CommentNextAiSuggestionResult>;
}

export function getAiSuggestionErrorMessage(error: unknown): string {
  if (!(error instanceof CommentNextAiError)) {
    return error instanceof Error && error.message
      ? error.message
      : 'AI 生成失败，请稍后再试。';
  }

  const detail = error.detail?.trim() ?? '';
  const title = error.title?.trim() ?? '';

  if (error.status === 401) {
    return '请先登录后再使用 AI 写作。';
  }

  if (error.status === 403) {
    return detail && hasChineseText(detail)
      ? detail
      : '当前站点未开启 AI 写作。';
  }

  if (error.status === 429) {
    return detail && hasChineseText(detail)
      ? detail
      : 'AI 生成过于频繁，请稍后再试。';
  }

  if (error.status === 400) {
    return detail && hasChineseText(detail)
      ? detail
      : 'AI 写作参数不正确。';
  }

  if (error.status === 404 || error.status === 503) {
    return detail && hasChineseText(detail)
      ? detail
      : 'Halo AI Foundation 插件未安装或未启用。';
  }

  if (error.status === 502 || error.status === 504 || error.status >= 500) {
    return detail && hasChineseText(detail)
      ? detail
      : 'AI 服务暂时不可用，请稍后再试。';
  }

  return detail || title || 'AI 生成失败，请稍后再试。';
}
