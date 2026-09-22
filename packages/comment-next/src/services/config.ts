import type { CommentNextBadgeConfig } from '../types/comment';
import { resolveApiUrl } from './api';
import type { CommentNextCaptchaConfig } from './captcha';

export interface CommentNextPluginConfig {
  basic?: CommentNextBasicConfig;
  security?: CommentNextSecurityConfig;
  ai?: CommentNextAiConfig;
  upload?: CommentNextUploadConfig;
  reaction?: CommentNextReactionConfig;
  report?: CommentNextReportConfig;
  editor?: CommentNextEditorConfig;
  badge?: CommentNextBadgeConfig;
  emote?: CommentNextEmoteConfig;
}

export interface CommentNextGlobalInfo {
  allowAnonymousComments?: boolean;
}

export interface CommentNextBasicConfig {
  size?: number;
  replySize?: number;
  withReplies?: boolean;
  withReplySize?: number;
  enablePrivateComment?: boolean;
  showCommenterDevice?: boolean;
  enableImageLightbox?: boolean;
}

export interface CommentNextSecurityConfig {
  captcha?: CommentNextCaptchaConfig;
}

export interface CommentNextAiConfig {
  enabled?: boolean;
  allowAnonymous?: boolean;
  mentionAutoReplyEnabled?: boolean;
  assistantName?: string;
  assistantUserName?: string;
  assistantDisplayName?: string;
  assistantMentionName?: string;
  buttonLabel?: string;
  maxInputLength?: number;
  foundationAvailable?: boolean;
}

export type CommentNextImageUploadProvider =
  | 'DISABLED'
  | 'HALO_ATTACHMENT'
  | 'IMGBB';

export interface CommentNextUploadConfig {
  enabled?: boolean;
  allowAnonymousUpload?: boolean;
  anonymousProvider?: CommentNextImageUploadProvider;
  authenticatedProvider?: CommentNextImageUploadProvider;
  anonymousMaxSizeKb?: number;
  authenticatedMaxSizeKb?: number;
}

export interface CommentNextReactionConfig {
  enabled?: boolean;
  allowAnonymous?: boolean;
  subjectEnabled?: boolean;
  commentEnabled?: boolean;
  replyEnabled?: boolean;
  subjectPrompt?: string;
  subjectItems?: CommentNextReactionOption[];
  commentItems?: CommentNextReactionOption[];
  items?: CommentNextReactionOption[];
}

export type CommentNextReactionOptionType = 'EMOJI' | 'IMAGE';

export interface CommentNextReactionOption {
  name?: string;
  type?: CommentNextReactionOptionType;
  value?: string;
  label?: string;
}

export interface CommentNextReportConfig {
  enabled?: boolean;
  allowAnonymous?: boolean;
  commentEnabled?: boolean;
  replyEnabled?: boolean;
  autoPendingEnabled?: boolean;
  autoPendingThreshold?: number;
}

export interface CommentNextEditorConfig {
  placeholder?: string;
}

export interface CommentNextEmoteConfig {
  defaultPaused?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  recentCommentMaxSize?: number;
  pageSize?: number;
  allowedHosts?: Array<{ host?: string }>;
}

const CONFIG_ENDPOINT = '/apis/api.commentnext.xhhao.com/v1alpha1/config';
const GLOBAL_INFO_ENDPOINT = '/actuator/globalinfo';

export async function fetchPluginConfig(
  baseUrl = ''
): Promise<CommentNextPluginConfig> {
  const response = await fetch(resolveApiUrl(baseUrl, CONFIG_ENDPOINT), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch comment next config: ${response.status}`);
  }

  return response.json() as Promise<CommentNextPluginConfig>;
}

export async function fetchGlobalInfo(
  baseUrl = ''
): Promise<CommentNextGlobalInfo> {
  const response = await fetch(resolveApiUrl(baseUrl, GLOBAL_INFO_ENDPOINT), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch global info: ${response.status}`);
  }

  return response.json() as Promise<CommentNextGlobalInfo>;
}
