import type {
  CommentNextAuthor,
  CommentNextBadge,
  CommentNextBadgeConfig,
  CommentNextComment,
} from '../types/comment';

const DEFAULT_FIRST_COMMENT_BADGE: CommentNextBadge = {
  id: 'first-comment',
  label: '首评',
  tone: 'first',
  icon: 'mdi:medal-outline',
  color: '#f59e0b',
  title: '本文第一位评论者',
};

const DEFAULT_ADMIN_BADGE: CommentNextBadge = {
  id: 'administrator',
  label: '站长',
  tone: 'admin',
  icon: 'mdi:shield-star-outline',
  color: '#3b82f6',
  title: '站点管理员',
};

export function resolveCommentBadges(
  comment: CommentNextComment,
  {
    isFirstComment = false,
    config = {},
  }: {
    isFirstComment?: boolean;
    config?: CommentNextBadgeConfig;
  } = {}
): CommentNextBadge[] {
  const badges: CommentNextBadge[] = [];

  if (isFirstComment && config.enableFirstCommentBadge !== false) {
    badges.push({
      ...DEFAULT_FIRST_COMMENT_BADGE,
      ...config.firstCommentBadge,
    });
  }

  if (isAdminAuthor(comment.author)) {
    badges.push({ ...DEFAULT_ADMIN_BADGE, ...config.adminBadge });
  }

  badges.push(...(comment.author.badges ?? []));

  return dedupeBadges(badges);
}

function isAdminAuthor(author: CommentNextAuthor): boolean {
  return author.role === 'admin';
}

function dedupeBadges(badges: CommentNextBadge[]): CommentNextBadge[] {
  const visited = new Set<string>();

  return badges.filter((badge) => {
    if (visited.has(badge.id)) {
      return false;
    }

    visited.add(badge.id);
    return true;
  });
}
