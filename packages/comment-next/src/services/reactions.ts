import { resolveApiUrl } from './api';

const TARGET_REACTION_ENDPOINT =
  '/apis/api.commentnext.xhhao.com/v1alpha1/target-reactions';

export type CommentNextReactionTargetType = 'SUBJECT' | 'COMMENT' | 'REPLY';
export type CommentNextReactionOptionType = 'EMOJI' | 'IMAGE';

export interface CommentNextReactionItem {
  name: string;
  type: CommentNextReactionOptionType;
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface CommentNextReactionSummary {
  targetType: string;
  targetKey: string;
  prompt: string;
  enabled: boolean;
  allowAnonymous: boolean;
  items: CommentNextReactionItem[];
}

export interface CommentNextReactionTarget {
  baseUrl?: string;
  targetType: CommentNextReactionTargetType;
  group?: string;
  kind?: string;
  version?: string;
  name: string;
}

export async function fetchReactionSummary(
  target: CommentNextReactionTarget
): Promise<CommentNextReactionSummary> {
  const url = new URL(
    resolveApiUrl(target.baseUrl ?? '', TARGET_REACTION_ENDPOINT),
    window.location.origin
  );
  appendTargetParams(url, target);

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch reaction summary: ${response.status}`);
  }

  return response.json() as Promise<CommentNextReactionSummary>;
}

export async function toggleReaction(
  target: CommentNextReactionTarget & { reaction: string }
): Promise<CommentNextReactionSummary> {
  const response = await fetch(
    resolveApiUrl(target.baseUrl ?? '', TARGET_REACTION_ENDPOINT),
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetType: target.targetType,
        group: target.group,
        kind: target.kind,
        version: target.version ?? 'v1alpha1',
        name: target.name,
        reaction: target.reaction,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to toggle reaction: ${response.status}`);
  }

  return response.json() as Promise<CommentNextReactionSummary>;
}

function appendTargetParams(url: URL, target: CommentNextReactionTarget) {
  url.searchParams.set('targetType', target.targetType);
  if (target.group) {
    url.searchParams.set('group', target.group);
  }
  if (target.kind) {
    url.searchParams.set('kind', target.kind);
  }
  if (target.version) {
    url.searchParams.set('version', target.version);
  }
  url.searchParams.set('name', target.name);
}
