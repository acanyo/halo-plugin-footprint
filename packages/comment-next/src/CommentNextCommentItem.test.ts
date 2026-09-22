import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CommentNextCommentItem from './CommentNextCommentItem.svelte';
import type { CommentNextComment } from './types/comment';

describe('CommentNextCommentItem reply pagination', () => {
  it('shows how many replies remain beyond the initial page', () => {
    const { body } = render(CommentNextCommentItem, {
      props: {
        comment: commentWithFiveOfSevenReplies(),
        replySize: 5,
      },
    });

    expect(body).toContain('展开剩余 2 条回复');
  });
});

function commentWithFiveOfSevenReplies(): CommentNextComment {
  return {
    id: 'comment-1',
    content: '<p>Comment</p>',
    author: { displayName: 'Commenter' },
    stats: { replies: 7 },
    replyPage: {
      page: 1,
      size: 5,
      total: 7,
      totalPages: 2,
      hasNext: true,
      hasPrevious: false,
    },
    replies: Array.from({ length: 5 }, (_, index) => ({
      id: `reply-${index + 1}`,
      content: `<p>reply-${index + 1}</p>`,
      author: { displayName: `User ${index + 1}` },
    })),
  };
}
