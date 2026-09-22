export type CommentNextAuthorRole = 'admin' | 'member' | 'anonymous';

export type CommentNextBadgeTone =
  | 'first'
  | 'admin'
  | 'level'
  | 'custom'
  | 'muted';

export interface CommentNextBadge {
  id: string;
  label: string;
  tone: CommentNextBadgeTone;
  icon?: string;
  color?: string;
  title?: string;
}

export interface CommentNextBadgeConfig {
  enableFirstCommentBadge?: boolean;
  firstCommentBadge?: Partial<CommentNextBadge>;
  adminBadge?: Partial<CommentNextBadge>;
}

export interface CommentNextAuthor {
  displayName: string;
  avatar?: string;
  website?: string;
  email?: string;
  kind?: string;
  role?: CommentNextAuthorRole;
  activeCommentCount?: number;
  badges?: CommentNextBadge[];
}

export interface CommentNextCommentStats {
  upvotes?: number;
  replies?: number;
}

export interface CommentNextPageInfo {
  page: number;
  size: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface CommentNextComment {
  id: string;
  content: string;
  creationTime?: string;
  approved?: boolean;
  private?: boolean;
  top?: boolean;
  featured?: boolean;
  priority?: number;
  quoteReplyId?: string;
  replyToName?: string;
  userAgent?: string;
  author: CommentNextAuthor;
  stats?: CommentNextCommentStats;
  replyPage?: CommentNextPageInfo;
  replies?: CommentNextComment[];
}

export type CommentNextCommentSort = 'hot' | 'latest' | 'earliest';

export interface CommentNextCommentPage {
  page: number;
  size: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  firstCommentId?: string;
  items: CommentNextComment[];
}
