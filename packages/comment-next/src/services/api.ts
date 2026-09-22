export interface HaloProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}

export async function readProblemDetail(
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

export function resolveApiUrl(baseUrl: string, endpoint: string): string {
  if (!baseUrl) {
    return endpoint;
  }

  return `${baseUrl.replace(/\/$/, '')}${endpoint}`;
}

export function hasChineseText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}
