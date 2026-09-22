import { resolveApiUrl } from './api';

const REPORTS_ENDPOINT = '/apis/api.commentnext.xhhao.com/v1alpha1/target-reports';

export type CommentNextReportTargetType = 'COMMENT' | 'REPLY';

export type CommentNextReportReason =
  | 'SPAM'
  | 'AD'
  | 'ABUSE'
  | 'PORN'
  | 'ILLEGAL'
  | 'OTHER';

export interface CommentNextReportResult {
  targetType: CommentNextReportTargetType;
  targetName: string;
  count: number;
  reported: boolean;
  duplicate: boolean;
  autoPending: boolean;
}

interface HaloProblemDetail {
  title?: string;
  detail?: string;
}

export async function submitReport({
  baseUrl = '',
  targetType,
  name,
  reason = 'OTHER',
  description,
}: {
  baseUrl?: string;
  targetType: CommentNextReportTargetType;
  name: string;
  reason?: CommentNextReportReason;
  description: string;
}): Promise<CommentNextReportResult> {
  const response = await fetch(resolveApiUrl(baseUrl, REPORTS_ENDPOINT), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType,
      name,
      reason,
      description,
    }),
  });

  if (!response.ok) {
    const problem = await readProblemDetail(response);
    throw new Error(
      problem?.detail ||
        problem?.title ||
        `Failed to report target: ${response.status}`
    );
  }

  return response.json() as Promise<CommentNextReportResult>;
}

async function readProblemDetail(
  response: Response
): Promise<HaloProblemDetail | undefined> {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('json')) {
    return undefined;
  }

  try {
    return (await response.json()) as HaloProblemDetail;
  } catch {
    return undefined;
  }
}
