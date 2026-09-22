import type {
  CommentNextBadge,
  CommentNextComment,
  CommentNextCommentPage,
  CommentNextCommentSort,
} from '../types/comment';
import {
  getAnonymousAvatarUrlFromHash,
  getDefaultAnonymousAvatarUrl,
} from '../avatar/weavatar';
import { getCaptchaCodeHeader, isCaptchaRequired } from './captcha';
import type { CommentNextCaptchaType } from './captcha';
import { sanitizeCommentSubmitHtml } from '../utils/html';

const COMMENTS_ENDPOINT = '/apis/api.commentnext.xhhao.com/v1alpha1/comments';

interface FetchCommentsOptions {
  baseUrl?: string;
  group: string;
  kind: string;
  name: string;
  version: string;
  page?: number;
  size?: number;
  withReplies?: boolean;
  replySize?: number;
  sort?: CommentNextCommentSort;
}

interface FetchRepliesOptions {
  baseUrl?: string;
  commentName: string;
  page?: number;
  size?: number;
}

interface CreateCommentOptions {
  baseUrl?: string;
  group: string;
  kind: string;
  name: string;
  version: string;
  content: string;
  allowedLottieHosts?: readonly unknown[];
  hidden?: boolean;
  captchaCode?: string;
  owner?: {
    displayName: string;
    email: string;
    website?: string;
  };
}

interface UpvoteOptions {
  baseUrl?: string;
  name: string;
  plural: 'comments' | 'replies';
}

interface CreateReplyOptions {
  baseUrl?: string;
  commentName: string;
  content: string;
  allowedLottieHosts?: readonly unknown[];
  captchaCode?: string;
  quoteReply?: string;
  owner?: {
    displayName: string;
    email: string;
    website?: string;
  };
}

interface HaloCommentRequest {
  raw: string;
  content: string;
  allowNotification: boolean;
  hidden: boolean;
  subjectRef: {
    group: string;
    kind: string;
    name: string;
    version: string;
  };
  owner?: {
    displayName: string;
    email: string;
    website?: string;
  };
}

interface HaloReplyRequest {
  raw: string;
  content: string;
  allowNotification: boolean;
  quoteReply?: string;
  owner?: {
    displayName: string;
    email: string;
    website?: string;
  };
}

interface HaloProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  captcha?: string;
  captchaType?: CommentNextCaptchaType;
}

interface HaloCommentPage {
  page?: number;
  size?: number;
  total?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  firstCommentName?: string;
  items?: HaloComment[];
}

interface HaloComment {
  replyToName?: string;
  metadata?: {
    name?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
  };
  top?: boolean;
  featured?: boolean;
  priority?: number;
  owner?: {
    displayName?: string;
    avatar?: string;
    kind?: string;
    name?: string;
    role?: string;
    activeCommentCount?: number;
    badges?: CommentNextBadge[];
  };
  spec?: {
    content?: string;
    creationTime?: string;
    approved?: boolean;
    hidden?: boolean;
    quoteReply?: string;
    userAgent?: string;
    top?: boolean;
    priority?: number;
    owner?: {
      name?: string;
      displayName?: string;
      kind?: string;
      role?: string;
      email?: string;
      annotations?: {
        'email-hash'?: string;
        website?: string;
      };
    };
  };
  stats?: {
    upvote?: number;
  };
  status?: {
    visibleReplyCount?: number;
  };
  replies?: HaloCommentPage;
}

export class CommentNextCommentError extends Error {
  status: number;
  type?: string;
  title?: string;
  detail?: string;
  captchaRequired: boolean;
  captchaImage?: string;
  captchaType?: CommentNextCaptchaType;

  constructor({
    status,
    type,
    title,
    detail,
    captchaRequired,
    captchaImage,
    captchaType,
  }: {
    status: number;
    type?: string;
    title?: string;
    detail?: string;
    captchaRequired?: boolean;
    captchaImage?: string;
    captchaType?: CommentNextCaptchaType;
  }) {
    super(detail || title || `Failed to submit comment: ${status}`);
    this.name = 'CommentNextCommentError';
    this.status = status;
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.captchaRequired = Boolean(captchaRequired);
    this.captchaImage = captchaImage;
    this.captchaType = captchaType;
  }
}

export function getCommentSubmitErrorMessage(
  error: CommentNextCommentError
): string {
  const type = error.type ?? '';
  const title = error.title?.trim() ?? '';
  const detail = error.detail?.trim() ?? '';
  const combined = `${title} ${detail}`.toLowerCase();

  if (type.includes('captcha-invalid')) {
    return detail && hasChineseText(detail)
      ? detail
      : '验证码错误，请重新输入。';
  }

  if (type.includes('captcha-required') || error.captchaRequired) {
    return detail && hasChineseText(detail) ? detail : '请先输入验证码。';
  }

  if (combined.includes('allow only system users to comment')) {
    return '当前站点仅允许登录用户评论，请登录后再试。';
  }

  if (
    combined.includes('access denied') ||
    combined.includes('forbidden') ||
    error.status === 403
  ) {
    return '没有权限提交评论，请检查登录状态或站点评论设置。';
  }

  if (error.status === 401) {
    return '请先登录后再提交评论。';
  }

  if (
    combined.includes('comment is not allowed') ||
    combined.includes('comments are closed') ||
    combined.includes('not allowed to comment')
  ) {
    return '当前内容不允许评论。';
  }

  if (error.status === 400) {
    return detail || title || '评论提交失败，请稍后再试。';
  }

  if (error.status === 429) {
    return '提交过于频繁，请稍后再试。';
  }

  if (error.status >= 500) {
    return '服务器处理评论失败，请稍后再试。';
  }

  if (detail && hasChineseText(detail)) {
    return detail;
  }

  if (title && hasChineseText(title)) {
    return title;
  }

  return '评论提交失败，请稍后再试。';
}

export async function fetchCommentPage(
  options: FetchCommentsOptions
): Promise<CommentNextCommentPage> {
  const page = options.page ?? 1;
  const size = options.size ?? 20;
  const url = new URL(
    resolveApiUrl(options.baseUrl, COMMENTS_ENDPOINT),
    window.location.origin
  );

  url.searchParams.set('group', options.group);
  url.searchParams.set('kind', options.kind);
  url.searchParams.set('name', options.name);
  url.searchParams.set('version', options.version);
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(size));
  url.searchParams.set('withReplies', String(options.withReplies ?? true));
  url.searchParams.set('replySize', String(options.replySize ?? 10));
  url.searchParams.set('sort', options.sort ?? 'latest');

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch comments: ${response.status}`);
  }

  return adaptHaloCommentPage(
    (await response.json()) as HaloCommentPage,
    page,
    size
  );
}

export async function fetchReplyPage(
  options: FetchRepliesOptions
): Promise<CommentNextCommentPage> {
  const page = options.page ?? 1;
  const size = options.size ?? 10;
  const url = new URL(
    resolveApiUrl(
      options.baseUrl,
      `${COMMENTS_ENDPOINT}/${encodeURIComponent(options.commentName)}/replies`
    ),
    window.location.origin
  );

  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(size));

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch replies: ${response.status}`);
  }

  return adaptHaloCommentPage(
    (await response.json()) as HaloCommentPage,
    page,
    size
  );
}

export async function createComment(
  options: CreateCommentOptions
): Promise<CommentNextComment> {
  const response = await fetch(
    resolveApiUrl(options.baseUrl, '/apis/api.halo.run/v1alpha1/comments'),
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getCaptchaCodeHeader(options.captchaCode ?? ''),
      },
      body: JSON.stringify(createCommentRequest(options)),
    }
  );

  if (!response.ok) {
    const problem = await readProblemDetail(response);

    throw new CommentNextCommentError({
      status: response.status,
      type: problem?.type,
      title: problem?.title,
      detail: problem?.detail,
      captchaRequired: isCaptchaRequired(response),
      captchaImage: problem?.captcha,
      captchaType: problem?.captchaType,
    });
  }

  return adaptHaloComment((await response.json()) as HaloComment);
}

export async function upvoteCommentTarget(
  options: UpvoteOptions
): Promise<void> {
  const response = await fetch(
    resolveApiUrl(options.baseUrl, '/apis/api.halo.run/v1alpha1/trackers/upvote'),
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: options.name,
        plural: options.plural,
        group: 'content.halo.run',
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to upvote ${options.plural}: ${response.status}`);
  }
}

export async function createReply(
  options: CreateReplyOptions
): Promise<CommentNextComment> {
  const response = await fetch(
    resolveApiUrl(
      options.baseUrl,
      `/apis/api.halo.run/v1alpha1/comments/${encodeURIComponent(options.commentName)}/reply`
    ),
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getCaptchaCodeHeader(options.captchaCode ?? ''),
      },
      body: JSON.stringify(createReplyRequest(options)),
    }
  );

  if (!response.ok) {
    const problem = await readProblemDetail(response);

    throw new CommentNextCommentError({
      status: response.status,
      type: problem?.type,
      title: problem?.title,
      detail: problem?.detail,
      captchaRequired: isCaptchaRequired(response),
      captchaImage: problem?.captcha,
      captchaType: problem?.captchaType,
    });
  }

  return adaptHaloComment((await response.json()) as HaloComment);
}

function createCommentRequest(
  options: CreateCommentOptions
): HaloCommentRequest {
  const content = sanitizeCommentSubmitHtml(
    options.content,
    options.allowedLottieHosts
  );
  const request: HaloCommentRequest = {
    raw: content,
    content,
    allowNotification: true,
    hidden: Boolean(options.hidden),
    subjectRef: {
      group: options.group,
      kind: options.kind,
      name: options.name,
      version: options.version,
    },
  };

  if (options.owner) {
    request.owner = {
      displayName: options.owner.displayName,
      email: options.owner.email,
      website: options.owner.website,
    };
  }

  return request;
}

function createReplyRequest(options: CreateReplyOptions): HaloReplyRequest {
  const content = sanitizeCommentSubmitHtml(
    options.content,
    options.allowedLottieHosts
  );
  const request: HaloReplyRequest = {
    raw: content,
    content,
    allowNotification: true,
  };

  if (options.quoteReply) {
    request.quoteReply = options.quoteReply;
  }

  if (options.owner) {
    request.owner = {
      displayName: options.owner.displayName,
      email: options.owner.email,
      website: options.owner.website,
    };
  }

  return request;
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

function resolveApiUrl(baseUrl = '', endpoint: string): string {
  if (!baseUrl) {
    return endpoint;
  }

  return `${baseUrl.replace(/\/$/, '')}${endpoint}`;
}

function hasChineseText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function adaptHaloCommentPage(
  data: HaloCommentPage,
  fallbackPage: number,
  fallbackSize: number
): CommentNextCommentPage {
  return {
    page: data.page ?? fallbackPage,
    size: data.size ?? fallbackSize,
    total: data.total ?? data.items?.length ?? 0,
    totalPages: data.totalPages ?? 1,
    hasNext: Boolean(data.hasNext),
    hasPrevious: Boolean(data.hasPrevious),
    firstCommentId: data.firstCommentName,
    items: (data.items ?? []).map(adaptHaloComment),
  };
}

function adaptHaloComment(comment: HaloComment): CommentNextComment {
  const owner = comment.owner ?? {};
  const specOwner = comment.spec?.owner ?? {};
  const displayName =
    owner.displayName ||
    specOwner.displayName ||
    '匿名用户';
  const kind = owner.kind || specOwner.kind;
  const role = resolveAuthorRole(owner.role || specOwner.role, kind);
  const emailHash = specOwner.annotations?.['email-hash'];

  return {
    id: comment.metadata?.name || crypto.randomUUID(),
    content: comment.spec?.content ?? '',
    creationTime:
      comment.spec?.creationTime ?? comment.metadata?.creationTimestamp,
    approved: comment.spec?.approved,
    private: comment.spec?.hidden,
    top: Boolean(comment.top ?? comment.spec?.top),
    featured: Boolean(comment.featured ?? isFeaturedComment(comment)),
    priority: normalizeNumber(comment.priority ?? comment.spec?.priority) ?? 0,
    quoteReplyId: comment.spec?.quoteReply,
    replyToName: textValue(comment.replyToName),
    userAgent: comment.spec?.userAgent,
    author: {
      displayName,
      avatar: resolveAuthorAvatar(owner.avatar, kind, emailHash),
      website: specOwner.annotations?.website,
      email: specOwner.email,
      kind,
      role,
      activeCommentCount: normalizeNumber(owner.activeCommentCount),
      badges: owner.badges,
    },
    stats: {
      upvotes: comment.stats?.upvote ?? 0,
      replies: comment.status?.visibleReplyCount ?? comment.replies?.total ?? 0,
    },
    replyPage: comment.replies
      ? {
          page: comment.replies.page ?? 1,
          size: comment.replies.size ?? 10,
          total: comment.replies.total ?? comment.replies.items?.length ?? 0,
          totalPages: comment.replies.totalPages ?? 1,
          hasNext: Boolean(comment.replies.hasNext),
          hasPrevious: Boolean(comment.replies.hasPrevious),
        }
      : undefined,
    replies: (comment.replies?.items ?? []).map(adaptHaloComment),
  };
}

function isFeaturedComment(comment: HaloComment): boolean {
  return Boolean(
    comment.metadata?.annotations?.['commentnext.xhhao.com/featured'] === 'true'
  );
}

function resolveAuthorAvatar(
  avatar?: string,
  kind?: string,
  emailHash?: string
): string | undefined {
  if (avatar) {
    return avatar;
  }

  if (kind === 'Email') {
    return emailHash
      ? getAnonymousAvatarUrlFromHash(emailHash)
      : getDefaultAnonymousAvatarUrl();
  }

  return undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) ? normalizedValue : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveAuthorRole(
  role?: string,
  kind?: string
): CommentNextComment['author']['role'] {
  if (role === 'admin' || role === 'member' || role === 'anonymous') {
    return role;
  }

  return kind === 'User' ? 'member' : 'anonymous';
}
