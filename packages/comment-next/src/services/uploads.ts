import {
  hasChineseText,
  readProblemDetail,
  resolveApiUrl,
} from './api';
import { toUploadableImageFile } from '../utils/image-files';

const IMAGE_UPLOAD_ENDPOINT =
  '/apis/api.commentnext.xhhao.com/v1alpha1/uploads/-/images';

interface UploadCommentImageOptions {
  baseUrl?: string;
  file: File;
}

export interface CommentNextImageUploadResult {
  url: string;
  provider?: string;
  filename?: string;
  size?: number;
  contentType?: string;
  attachmentName?: string;
}

export class CommentNextUploadError extends Error {
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
    super(detail || title || `Failed to upload image: ${status}`);
    this.name = 'CommentNextUploadError';
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

export async function uploadCommentImage({
  baseUrl = '',
  file,
}: UploadCommentImageOptions): Promise<CommentNextImageUploadResult> {
  const uploadFile = toUploadableImageFile(file);
  const formData = new FormData();
  formData.append('file', uploadFile);

  const response = await fetch(resolveApiUrl(baseUrl, IMAGE_UPLOAD_ENDPOINT), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const problem = await readProblemDetail(response);
    throw new CommentNextUploadError({
      status: response.status,
      title: problem?.title,
      detail: problem?.detail,
    });
  }

  return response.json() as Promise<CommentNextImageUploadResult>;
}

export function getImageUploadErrorMessage(error: unknown): string {
  if (!(error instanceof CommentNextUploadError)) {
    return error instanceof Error && error.message
      ? error.message
      : '图片上传失败，请稍后再试。';
  }

  const detail = error.detail?.trim() ?? '';
  const title = error.title?.trim() ?? '';

  if (error.status === 401) {
    return '请先登录后再上传图片。';
  }

  if (error.status === 403) {
    return detail && hasChineseText(detail)
      ? detail
      : '当前站点未允许图片上传。';
  }

  if (error.status === 413) {
    return detail && hasChineseText(detail)
      ? detail
      : '图片大小超过限制，请压缩后再上传。';
  }

  if (error.status === 429) {
    return detail && hasChineseText(detail)
      ? detail
      : '上传过于频繁，请稍后再试。';
  }

  if (error.status === 400) {
    return detail && hasChineseText(detail)
      ? detail
      : '图片类型或上传配置不正确。';
  }

  if (error.status >= 500) {
    return detail && hasChineseText(detail)
      ? detail
      : '图片服务暂时不可用，请稍后再试。';
  }

  return detail || title || '图片上传失败，请稍后再试。';
}
