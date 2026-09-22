export type CommentNextEmoteProvider = 'OWO' | 'LOTTIE';
export type CommentNextEmoteType = 'emoticon' | 'image' | 'lottie';

export interface CommentNextLottieDefaults {
  width: number;
  height: number;
  autoplay: boolean;
  loop: boolean;
  speed: number;
  fit: string;
  align: string;
  controls: boolean;
  hoverPlay: boolean;
  freezeOnOffscreen: boolean;
  ariaLabel?: string;
}

export interface CommentNextEmoteItem {
  id: string;
  type: CommentNextEmoteType;
  label: string;
  value: string;
  description?: string;
  previewSrc?: string;
  originSrc?: string;
  src?: string;
  provider?: CommentNextEmoteProvider;
  animationName?: string;
  contentUrl?: string;
  format?: string;
  defaults?: CommentNextLottieDefaults;
}

export interface CommentNextEmotePack {
  id: string;
  name: string;
  provider: CommentNextEmoteProvider;
  type: CommentNextEmoteType;
  items: CommentNextEmoteItem[];
}

export interface CommentNextRawEmotePack {
  id?: string;
  name?: string;
  provider?: string;
  type?: string;
  container?: unknown[];
}

export interface CommentNextRawEmoteResponse {
  packs?: unknown[];
  [name: string]: unknown;
}

export type CommentNextRawEmotePacks = Record<string, CommentNextRawEmotePack>;
