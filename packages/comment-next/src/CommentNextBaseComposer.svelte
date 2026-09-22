<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import {
  getAnonymousAvatarUrl,
  getDefaultAnonymousAvatarUrl,
} from './avatar/weavatar';
import CommentNextAccountFields from './CommentNextAccountFields.svelte';
import CommentNextCaptchaDialog from './CommentNextCaptchaDialog.svelte';
import CommentNextEditor from './CommentNextEditor.svelte';
import CommentNextFooter from './CommentNextFooter.svelte';
import CommentNextIcon from './CommentNextIcon.svelte';
import CommentNextNotice from './CommentNextNotice.svelte';
import CommentNextSkeleton from './CommentNextSkeleton.svelte';
import {
  type CommentNextAiMode,
  generateCommentAiSuggestion,
  getAiSuggestionErrorMessage,
} from './services/ai';
import {
  loadAnonymousAccount,
  saveAnonymousAccount,
} from './services/anonymous-account';
import {
  type CommentNextCaptchaConfig,
  isLocalImageCaptcha,
} from './services/captcha';
import {
  CommentNextCommentError,
  getCommentSubmitErrorMessage,
} from './services/comments';
import type {
  CommentNextAiConfig,
  CommentNextEmoteConfig,
  CommentNextSecurityConfig,
  CommentNextUploadConfig,
} from './services/config';
import { type CurrentUser, fetchCurrentUser } from './services/current-user';
import { fetchQqProfile, isQqEmail } from './services/qq-profile';
import {
  CommentNextUploadError,
  getImageUploadErrorMessage,
  uploadCommentImage,
} from './services/uploads';
import type { CommentNextComment } from './types/comment';
import type { CommentNextComposerSubmitPayload } from './types/composer';
import type { CommentNextEditorImageKind } from './types/editor';
import type { CommentNextEmoteItem, CommentNextEmotePack } from './types/emote';
import { sanitizeCommentSubmitHtml } from './utils/html';
import { inferImageContentType, isImageContentType } from './utils/image-files';
import {
  COMMENT_NEXT_MODAL_OPEN_EVENT,
  notifyCommentNextModalOpen,
} from './utils/overlays';

type CommentNextComposerVariant = 'comment' | 'reply';

type CommentNextLimitedMedia = {
  type: 'emote' | 'lottie';
  width: number;
  height: number;
};

const DEFAULT_EMOTE_MEDIA_LIMIT = 512;
const MIN_EMOTE_MEDIA_LIMIT = 24;
const MAX_EMOTE_MEDIA_LIMIT = 4096;

type CommentNextEditorRef = {
  getHtml: () => string;
  getText: () => string;
  reset: () => void;
  focus: () => void;
  insertText: (value: string) => void;
  replaceText: (value: string) => void;
  insertImage: (
    src: string,
    alt?: string,
    kind?: CommentNextEditorImageKind
  ) => void;
  insertLottie: (item: CommentNextEmoteItem) => void;
  replaceImageSrc: (sourceSrc: string, targetSrc: string, alt?: string) => void;
  getLimitedMediaDimensions: () => CommentNextLimitedMedia[];
  consumeCommandTrigger: () => void;
};

type PendingImageUpload = {
  src: string;
  file: File;
};

const {
  baseUrl = '',
  loggedIn = false,
  allowAnonymous = true,
  showCaptcha = false,
  captchaType = 'ALPHANUMERIC',
  captchaConfig,
  enablePrivate = true,
  loading = false,
  submitting = false,
  commandMenuOpen = false,
  inlineSuggestion = false,
  selectionTools = false,
  placeholder = '写下你的评论...',
  subject = '',
  targetReady = true,
  targetMissingMessage = '评论目标缺失，无法提交。',
  successMessage = '评论提交成功。',
  reviewPendingMessage = '',
  genericErrorMessage = '评论提交失败，请稍后再试。',
  createdEventName = '',
  variant = 'comment',
  compact = false,
  showHeader = false,
  replyToName = '',
  submitLabel = '提交',
  loginLabel = '登录后评论',
  aiLabel = 'AI 助手',
  aiAssistantName = '评论助手',
  showAi = true,
  showInsertTools = true,
  showAccountFields = true,
  showFooter = true,
  showSubmitArea = true,
  allowImages = true,
  aiConfig,
  uploadConfig,
  emoteConfig,
  emotePacks = [],
  loginRedirectHash = '',
  onChange = () => {},
  onSubmit = async () => undefined,
  onCreated = () => {},
  onCancel = () => {},
}: {
  baseUrl?: string;
  loggedIn?: boolean;
  allowAnonymous?: boolean;
  showCaptcha?: boolean;
  captchaType?: NonNullable<CommentNextSecurityConfig['captcha']>['type'];
  captchaConfig?: CommentNextCaptchaConfig;
  enablePrivate?: boolean;
  loading?: boolean;
  submitting?: boolean;
  commandMenuOpen?: boolean;
  inlineSuggestion?: boolean;
  selectionTools?: boolean;
  placeholder?: string;
  subject?: string;
  targetReady?: boolean;
  targetMissingMessage?: string;
  successMessage?: string;
  reviewPendingMessage?: string;
  genericErrorMessage?: string;
  createdEventName?: string;
  variant?: CommentNextComposerVariant;
  compact?: boolean;
  showHeader?: boolean;
  replyToName?: string;
  submitLabel?: string;
  loginLabel?: string;
  aiLabel?: string;
  aiAssistantName?: string;
  showAi?: boolean;
  showInsertTools?: boolean;
  showAccountFields?: boolean;
  showFooter?: boolean;
  showSubmitArea?: boolean;
  allowImages?: boolean;
  aiConfig?: CommentNextAiConfig;
  uploadConfig?: CommentNextUploadConfig;
  emoteConfig?: CommentNextEmoteConfig;
  emotePacks?: CommentNextEmotePack[];
  loginRedirectHash?: string;
  onChange?: (html: string) => void;
  onSubmit?: (
    payload: CommentNextComposerSubmitPayload
  ) => Promise<unknown> | unknown;
  onCreated?: (result: unknown) => void;
  onCancel?: () => void;
} = $props();

let isAiPanelOpen = $state(false);
let showInlineSuggestion = $state(false);
let showSelectionTools = $state(false);
let previousVariant = $state<CommentNextComposerVariant | undefined>();
let aiMode = $state<CommentNextAiMode>('polish');
let aiGenerating = $state(false);
let aiSuggestionText = $state('');
let aiSuggestionMode = $state<CommentNextAiMode>('polish');
let anonymousDisplayName = $state('');
let anonymousEmail = $state('');
let anonymousWebsite = $state('');
let captchaCode = $state('');
let captchaImage = $state('');
let captchaRefreshKey = $state(0);
let captchaDialogOpen = $state(false);
let captchaDialogError = $state('');
let externalCaptchaStarting = $state(false);
let currentUser = $state<CurrentUser | undefined>();
let anonymousAvatarUrl = $state(getDefaultAnonymousAvatarUrl());
let qqProfileLookupRequestId = 0;
// biome-ignore lint/style/useConst: Svelte assigns this through bind:this.
let composerElement = $state<HTMLFormElement | undefined>();
// biome-ignore lint/style/useConst: Svelte assigns this through bind:this.
let editorRef = $state<CommentNextEditorRef | undefined>();
let editorHtml = $state('');
let localSubmitting = $state(false);
let imageUploading = $state(false);
let submitMessage = $state('');
let submitMessageType = $state<'error' | 'success'>('error');
const pendingImageUploads = new Map<string, PendingImageUpload>();

const isLoggedIn = $derived(Boolean(currentUser) || loggedIn);
const isSubmitting = $derived(submitting || localSubmitting);
const showAccountBar = $derived(
  showAccountFields && (isLoggedIn || allowAnonymous)
);
const currentUserDisplayName = $derived(
  currentUser?.displayName || (loggedIn ? '已登录用户' : '')
);
const currentUserAvatar = $derived(currentUser?.avatar || '');
const anonymousMissingRequired = $derived(
  !isLoggedIn &&
    allowAnonymous &&
    (!anonymousDisplayName.trim() || !anonymousEmail.trim())
);
const captchaRequired = $derived(!isLoggedIn && allowAnonymous && showCaptcha);
const captchaMissingRequired = $derived(captchaRequired && !captchaCode.trim());
const captchaMissingMessage = $derived(
  isLocalImageCaptcha(captchaType) ? '请先填写验证码' : '请先完成验证'
);
const externalCaptchaRequired = $derived(
  captchaRequired && !isLocalImageCaptcha(captchaType)
);
const resolvedSubmitLabel = $derived(
  externalCaptchaStarting
    ? '验证中'
    : imageUploading
      ? '上传图片中'
      : submitLabel
);
const imageUploadEnabled = $derived(resolveImageUploadEnabled());
const imageAccept = 'image/*';
const aiWritingEnabled = $derived(showAi && resolveAiWritingEnabled());
const resolvedAiLabel = $derived(
  resolveTextOption(aiConfig?.buttonLabel, aiLabel, 'AI 助手')
);
const resolvedAiAssistantName = $derived(
  resolveTextOption(
    aiConfig?.assistantDisplayName || aiConfig?.assistantName,
    aiAssistantName,
    '评论助手'
  )
);
const resolvedAiAssistantMentionName = $derived(
  resolveMentionName(aiConfig?.assistantMentionName, resolvedAiAssistantName)
);
const editorTopRounded = $derived(!showHeader && !showAccountBar);

onMount(() => {
  const handleModalOpen = () => {
    closeFloatingPanels();
  };

  window.addEventListener(COMMENT_NEXT_MODAL_OPEN_EVENT, handleModalOpen);

  return () => {
    window.removeEventListener(COMMENT_NEXT_MODAL_OPEN_EVENT, handleModalOpen);
  };
});

$effect(() => {
  isAiPanelOpen = commandMenuOpen;
  showInlineSuggestion = inlineSuggestion;
  showSelectionTools = selectionTools;
});

$effect(() => {
  if (previousVariant !== variant) {
    previousVariant = variant;
    aiMode = variant === 'reply' ? 'reply' : 'polish';
    aiSuggestionMode = aiMode;
  }
});

$effect(() => {
  if (!captchaRequired) {
    captchaCode = '';
    captchaDialogError = '';
    captchaDialogOpen = false;
    externalCaptchaStarting = false;
  }
});

$effect(() => {
  const email = anonymousEmail;
  let cancelled = false;

  getAnonymousAvatarUrl(email)
    .then((avatarUrl) => {
      if (!cancelled) {
        anonymousAvatarUrl = avatarUrl;
      }
    })
    .catch(() => {
      if (!cancelled) {
        anonymousAvatarUrl = getDefaultAnonymousAvatarUrl();
      }
    });

  return () => {
    cancelled = true;
  };
});

onMount(() => {
  let cancelled = false;

  restoreAnonymousAccount();

  if (variant === 'reply') {
    window.setTimeout(() => {
      editorRef?.focus();
      composerElement?.scrollIntoView({
        block: 'center',
        inline: 'start',
        behavior: 'smooth',
      });
    }, 0);
  }

  fetchCurrentUser(baseUrl)
    .then((user) => {
      if (!cancelled) {
        currentUser = user;
      }
    })
    .catch(() => {
      if (!cancelled) {
        currentUser = undefined;
      }
    });

  return () => {
    cancelled = true;
  };
});

onDestroy(() => {
  qqProfileLookupRequestId += 1;
  clearPendingImageUploads();
});

export function focus() {
  editorRef?.focus();
}

export function reset() {
  editorRef?.reset();
  editorHtml = '';
  clearPendingImageUploads();
  onChange('');
}

function handleLogin() {
  const redirectHash = loginRedirectHash || window.location.hash;
  window.location.href = `/login?redirect_uri=${encodeURIComponent(
    window.location.pathname + redirectHash
  )}`;
}

function closeFloatingPanels() {
  isAiPanelOpen = false;
  showSelectionTools = false;
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  await submitComposer({ allowCaptchaDialog: true });
}

async function submitComposer({
  allowCaptchaDialog,
  captchaCodeOverride,
}: {
  allowCaptchaDialog: boolean;
  captchaCodeOverride?: string;
}) {
  if (isSubmitting) {
    return;
  }

  submitMessage = '';

  if (!targetReady) {
    showSubmitMessage(targetMissingMessage);
    return;
  }

  if (!isLoggedIn && !allowAnonymous) {
    handleLogin();
    return;
  }

  if (anonymousMissingRequired) {
    showSubmitMessage('请先填写昵称和邮箱。');
    return;
  }

  const rawContent = editorRef?.getHtml() || editorHtml;

  if (!hasContent(rawContent)) {
    showSubmitMessage(
      variant === 'reply' ? '请先输入回复内容。' : '请先输入评论内容。'
    );
    editorRef?.focus();
    return;
  }

  const mediaLimitMessage = validateLimitedEmoteDimensions();
  if (mediaLimitMessage) {
    showSubmitMessage(mediaLimitMessage);
    editorRef?.focus();
    return;
  }

  const resolvedCaptchaCode = captchaCodeOverride ?? captchaCode;
  const captchaMissing = captchaRequired && !resolvedCaptchaCode.trim();

  if (captchaMissing && allowCaptchaDialog) {
    openCaptchaDialog();
    return;
  }

  if (captchaMissing) {
    showSubmitMessage(`${captchaMissingMessage}。`);
    return;
  }

  const form = composerElement;
  if (!form) {
    showSubmitMessage(genericErrorMessage);
    return;
  }
  const formData = new FormData(form);

  try {
    localSubmitting = true;
    const content = await prepareContentForSubmit(rawContent);

    if (!hasContent(content)) {
      showSubmitMessage(
        variant === 'reply' ? '请先输入回复内容。' : '请先输入评论内容。'
      );
      editorRef?.focus();
      return;
    }

    const payload: CommentNextComposerSubmitPayload = {
      content,
      hidden: enablePrivate && isLoggedIn && formData.get('hidden') === 'on',
      captchaCode: resolvedCaptchaCode,
      owner: isLoggedIn
        ? undefined
        : {
            displayName: anonymousDisplayName.trim(),
            email: anonymousEmail.trim(),
            website: anonymousWebsite.trim(),
          },
    };

    const result = await onSubmit(payload);

    storeAnonymousAccount();
    editorRef?.reset();
    clearPendingImageUploads();
    captchaCode = '';
    captchaImage = '';
    captchaDialogError = '';
    captchaDialogOpen = false;
    externalCaptchaStarting = false;
    captchaRefreshKey += 1;
    showSubmitMessage(resolveSubmitSuccessMessage(result), 'success');

    if (createdEventName) {
      window.dispatchEvent(new CustomEvent(createdEventName));
    }

    onCreated(result);
  } catch (error) {
    if (error instanceof CommentNextCommentError) {
      if (error.captchaRequired) {
        const message = getCommentSubmitErrorMessage(error);
        captchaCode = '';
        captchaImage = error.captchaImage ?? '';
        captchaRefreshKey += error.captchaImage ? 0 : 1;
        captchaDialogError = message;
        externalCaptchaStarting = false;
        if (!isLocalImageCaptcha(captchaType)) {
          captchaDialogOpen = false;
          showSubmitMessage(message);
          return;
        }
        notifyCommentNextModalOpen('captcha');
        captchaDialogOpen = true;
        return;
      }

      captchaDialogError = '';
      captchaDialogOpen = false;
      externalCaptchaStarting = false;
      showSubmitMessage(getCommentSubmitErrorMessage(error));
      return;
    }

    if (error instanceof CommentNextUploadError) {
      captchaDialogError = '';
      captchaDialogOpen = false;
      externalCaptchaStarting = false;
      showSubmitMessage(getImageUploadErrorMessage(error));
      return;
    }

    if (error instanceof Error && error.message) {
      captchaDialogError = '';
      captchaDialogOpen = false;
      externalCaptchaStarting = false;
      showSubmitMessage(error.message);
      return;
    }

    console.error(error);
    captchaDialogError = '';
    captchaDialogOpen = false;
    externalCaptchaStarting = false;
    showSubmitMessage(genericErrorMessage);
  } finally {
    localSubmitting = false;
  }
}

function openCaptchaDialog() {
  if (isLocalImageCaptcha(captchaType) && !captchaImage) {
    captchaRefreshKey += 1;
  }

  notifyCommentNextModalOpen('captcha');
  submitMessage = '';
  captchaDialogError = '';
  externalCaptchaStarting = externalCaptchaRequired;
  captchaDialogOpen = true;
}

function handleCaptchaConfirm() {
  if (!captchaCode.trim() || isSubmitting) {
    return;
  }

  captchaDialogError = '';
  void submitComposer({ allowCaptchaDialog: false });
}

function handleCaptchaVerified(value: string) {
  const token = value.trim();
  if (!token || isSubmitting) {
    return;
  }

  captchaCode = token;
  captchaDialogError = '';
  captchaDialogOpen = false;
  externalCaptchaStarting = false;
  void submitComposer({
    allowCaptchaDialog: false,
    captchaCodeOverride: token,
  });
}

function showSubmitMessage(
  message: string,
  type: 'error' | 'success' = 'error'
) {
  externalCaptchaStarting = false;
  submitMessage = message;
  submitMessageType = type;
}

function hasContent(html: string): boolean {
  if (!html.trim()) {
    return false;
  }

  const template = document.createElement('template');
  template.innerHTML = html;

  return Boolean(
    template.content.textContent?.trim() ||
      template.content.querySelector('img[src], halo-lottie[src]')
  );
}

function validateLimitedEmoteDimensions(): string | undefined {
  const maxWidth = resolveEmoteMediaLimit(emoteConfig?.maxWidth);
  const maxHeight = resolveEmoteMediaLimit(emoteConfig?.maxHeight);

  for (const media of editorRef?.getLimitedMediaDimensions() ?? []) {
    if (media.type === 'lottie') {
      continue;
    }

    const label = '表情图片';
    if (media.width > maxWidth) {
      return `${label}宽度不能超过 ${maxWidth}px。`;
    }
    if (media.height > maxHeight) {
      return `${label}高度不能超过 ${maxHeight}px。`;
    }
  }

  return undefined;
}

function resolveEmoteMediaLimit(value: number | undefined): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_EMOTE_MEDIA_LIMIT;
  }

  return Math.min(
    MAX_EMOTE_MEDIA_LIMIT,
    Math.max(MIN_EMOTE_MEDIA_LIMIT, Math.round(numericValue))
  );
}

function resolveSubmitSuccessMessage(result: unknown): string {
  if (isPendingReviewComment(result)) {
    return (
      reviewPendingMessage ||
      (variant === 'reply'
        ? '回复提交成功，审核后可见。'
        : '评论提交成功，审核后可见。')
    );
  }

  return successMessage;
}

function isPendingReviewComment(result: unknown): result is CommentNextComment {
  return (
    result !== null &&
    typeof result === 'object' &&
    'approved' in result &&
    (result as CommentNextComment).approved === false
  );
}

function restoreAnonymousAccount() {
  const account = loadAnonymousAccount();

  if (!account) {
    return;
  }

  anonymousDisplayName = account.displayName;
  anonymousEmail = account.email;
  anonymousWebsite = account.website ?? '';
}

function storeAnonymousAccount() {
  if (isLoggedIn) {
    return;
  }

  saveAnonymousAccount({
    displayName: anonymousDisplayName,
    email: anonymousEmail,
    website: anonymousWebsite,
  });
}

async function handleAnonymousEmailBlur(email: string) {
  const expectedEmail = email.trim().toLowerCase();
  if (isLoggedIn || anonymousDisplayName.trim() || !isQqEmail(expectedEmail)) {
    return;
  }

  const requestId = ++qqProfileLookupRequestId;
  try {
    const profile = await fetchQqProfile(baseUrl, expectedEmail);
    if (
      requestId !== qqProfileLookupRequestId ||
      isLoggedIn ||
      anonymousDisplayName.trim() ||
      anonymousEmail.trim().toLowerCase() !== expectedEmail
    ) {
      return;
    }

    if (profile?.nickname) {
      anonymousDisplayName = profile.nickname;
    }
  } catch {
    // QQ nickname lookup is optional; keep manual input available on failure.
  }
}

function handleEmoteSelect(item: CommentNextEmoteItem) {
  if (item.type === 'lottie') {
    editorRef?.insertLottie(item);
    return;
  }

  if (item.type === 'image') {
    if (!allowImages) {
      return;
    }

    editorRef?.insertImage(item.src || item.value, item.label, 'emote');
    return;
  }

  editorRef?.insertText(item.value);
}

async function handleImageUpload(file: File) {
  submitMessage = '';

  if (!imageUploadEnabled) {
    showSubmitMessage(
      isLoggedIn ? '当前站点未开启图片上传。' : '请先登录后再上传图片。'
    );
    return;
  }

  const localValidationMessage = validateImageFile(file);
  if (localValidationMessage) {
    showSubmitMessage(localValidationMessage);
    return;
  }

  const src = URL.createObjectURL(file);
  pendingImageUploads.set(src, {
    src,
    file,
  });
  editorRef?.insertImage(src, file.name || '图片');
  showSubmitMessage('图片已添加，将在提交评论时上传。', 'success');
}

async function handleImagePaste(files: File[]) {
  if (!files.length) {
    return;
  }

  if (isSubmitting) {
    showSubmitMessage('正在提交中，请稍后再试。');
    return;
  }

  submitMessage = '';

  for (const file of files) {
    await handleImageUpload(file);
  }
}

async function prepareContentForSubmit(rawContent: string): Promise<string> {
  await uploadPendingImagesForSubmit(rawContent);
  return sanitizeCommentSubmitHtml(
    editorRef?.getHtml() || editorHtml,
    emoteConfig?.allowedHosts
  );
}

async function uploadPendingImagesForSubmit(rawContent: string): Promise<void> {
  const referencedUploads = getReferencedPendingImageUploads(rawContent);

  if (!referencedUploads.length) {
    pruneUnusedPendingImages(rawContent);
    return;
  }

  imageUploading = true;

  try {
    for (const pendingUpload of referencedUploads) {
      const result = await uploadCommentImage({
        baseUrl,
        file: pendingUpload.file,
      });
      const uploadedUrl = result.url;

      editorRef?.replaceImageSrc(
        pendingUpload.src,
        uploadedUrl,
        result.filename || pendingUpload.file.name || '图片'
      );
      revokePendingImageUpload(pendingUpload.src);
    }
  } finally {
    imageUploading = false;
  }
}

function getReferencedPendingImageUploads(html: string): PendingImageUpload[] {
  if (!pendingImageUploads.size) {
    return [];
  }

  const referencedSrcs = getImageSrcs(html);

  return Array.from(pendingImageUploads.values()).filter((pendingUpload) =>
    referencedSrcs.has(pendingUpload.src)
  );
}

function pruneUnusedPendingImages(html: string) {
  if (!pendingImageUploads.size) {
    return;
  }

  const referencedSrcs = getImageSrcs(html);

  for (const pendingUpload of Array.from(pendingImageUploads.values())) {
    if (!referencedSrcs.has(pendingUpload.src)) {
      revokePendingImageUpload(pendingUpload.src);
    }
  }
}

function getImageSrcs(html: string): Set<string> {
  const srcs = new Set<string>();

  if (!html.trim()) {
    return srcs;
  }

  const template = document.createElement('template');
  template.innerHTML = html;

  for (const image of Array.from(
    template.content.querySelectorAll('img[src]')
  )) {
    const src = image.getAttribute('src');
    if (src) {
      srcs.add(src);
    }
  }

  return srcs;
}

function revokePendingImageUpload(src: string) {
  const pendingUpload = pendingImageUploads.get(src);

  if (!pendingUpload) {
    return;
  }

  URL.revokeObjectURL(pendingUpload.src);
  pendingImageUploads.delete(src);
}

function clearPendingImageUploads() {
  for (const pendingUpload of Array.from(pendingImageUploads.values())) {
    URL.revokeObjectURL(pendingUpload.src);
  }

  pendingImageUploads.clear();
}

async function handleAiModeSelect(mode: CommentNextAiMode | string) {
  const nextMode = normalizeAiMode(mode);

  if (aiGenerating) {
    return;
  }

  editorRef?.consumeCommandTrigger();
  submitMessage = '';
  aiMode = nextMode;
  aiSuggestionMode = nextMode;
  aiSuggestionText = '';
  isAiPanelOpen = false;
  showSelectionTools = false;

  if (!aiWritingEnabled) {
    showInlineSuggestion = false;
    showSubmitMessage(
      isLoggedIn ? '当前站点未开启 AI 写作。' : '请先登录后再使用 AI 写作。'
    );
    return;
  }

  const content = editorRef?.getText() ?? textFromHtml(editorHtml);
  const localValidationMessage = validateAiInput(nextMode, content);

  if (localValidationMessage) {
    showInlineSuggestion = false;
    showSubmitMessage(localValidationMessage);
    editorRef?.focus();
    return;
  }

  try {
    showInlineSuggestion = true;
    aiGenerating = true;
    const result = await generateCommentAiSuggestion({
      baseUrl,
      mode: nextMode,
      content,
      variant,
      subject,
      replyToName,
    });
    aiSuggestionText = result.text;
  } catch (error) {
    showInlineSuggestion = false;
    showSubmitMessage(getAiSuggestionErrorMessage(error));
  } finally {
    aiGenerating = false;
  }
}

function handleAcceptAiSuggestion() {
  if (!aiSuggestionText || aiGenerating) {
    return;
  }

  editorRef?.replaceText(aiSuggestionText);
  closeAiSuggestion();
}

function handleInsertAiSuggestion() {
  if (!aiSuggestionText || aiGenerating) {
    return;
  }

  editorRef?.insertText(aiSuggestionText);
  closeAiSuggestion();
}

function handleRewriteAiSuggestion() {
  if (aiGenerating) {
    return;
  }

  void handleAiModeSelect(aiSuggestionMode);
}

function closeAiSuggestion() {
  showInlineSuggestion = false;
  aiSuggestionText = '';
}

function normalizeAiMode(mode: CommentNextAiMode | string): CommentNextAiMode {
  if (mode === 'reply' && variant !== 'reply') {
    return 'polish';
  }

  if (
    mode === 'polish' ||
    mode === 'expand' ||
    mode === 'question' ||
    mode === 'reply' ||
    mode === 'summary'
  ) {
    return mode;
  }

  return variant === 'reply' ? 'reply' : 'polish';
}

function validateAiInput(mode: CommentNextAiMode, content: string): string {
  const normalizedContent = content.trim();
  const maxInputLength = Number(aiConfig?.maxInputLength);

  if (
    Number.isFinite(maxInputLength) &&
    maxInputLength > 0 &&
    normalizedContent.length > maxInputLength
  ) {
    return `AI 输入内容不能超过 ${maxInputLength} 个字符。`;
  }

  if (mode !== 'reply' && mode !== 'summary' && !normalizedContent) {
    return '请先输入需要 AI 处理的内容。';
  }

  if (mode === 'summary' && !subject.trim()) {
    return '缺少文章信息，无法总结文章评论。';
  }

  if (mode === 'reply' && !normalizedContent && !replyToName.trim()) {
    return '请先输入回复内容或选择回复对象。';
  }

  return '';
}

function resolveAiWritingEnabled(): boolean {
  if (!aiConfig?.enabled) {
    return false;
  }

  if (!aiConfig.foundationAvailable) {
    return false;
  }

  return isLoggedIn || Boolean(aiConfig.allowAnonymous);
}

function resolveImageUploadEnabled(): boolean {
  if (!allowImages) {
    return false;
  }

  if (!uploadConfig?.enabled) {
    return false;
  }

  if (isLoggedIn) {
    return uploadConfig.authenticatedProvider !== 'DISABLED';
  }

  return Boolean(
    uploadConfig.allowAnonymousUpload &&
      uploadConfig.anonymousProvider !== 'DISABLED'
  );
}

function validateImageFile(file: File): string {
  const contentType = inferImageContentType(file);

  if (!contentType || !isImageContentType(contentType)) {
    return '仅支持上传图片文件。';
  }

  const maxSizeKb = isLoggedIn
    ? uploadConfig?.authenticatedMaxSizeKb
    : uploadConfig?.anonymousMaxSizeKb;
  const normalizedMaxSizeKb = Number(maxSizeKb);

  if (
    Number.isFinite(normalizedMaxSizeKb) &&
    normalizedMaxSizeKb > 0 &&
    file.size > normalizedMaxSizeKb * 1024
  ) {
    return `图片大小不能超过 ${formatMaxImageSize(normalizedMaxSizeKb)}。`;
  }

  return '';
}

function formatMaxImageSize(maxSizeKb: number): string {
  if (maxSizeKb >= 1024) {
    return `${Number((maxSizeKb / 1024).toFixed(1))} MB`;
  }

  return `${maxSizeKb} KB`;
}

function textFromHtml(html: string): string {
  if (!html.trim()) {
    return '';
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent?.trim() ?? '';
}

function resolveTextOption(
  configuredValue: string | undefined,
  propValue: string,
  fallback: string
): string {
  return configuredValue?.trim() || propValue.trim() || fallback;
}

function resolveMentionName(
  configuredValue: string | undefined,
  displayName: string
): string {
  const value = configuredValue?.trim() || displayName.trim() || '评论助手';
  return value.startsWith('@') ? value : `@${value}`;
}
</script>

<form
  bind:this={composerElement}
  class:comment-next-box={variant === "comment"}
  class:comment-next-reply-composer={variant === "reply"}
  class:comment-next-composer-loading={loading}
  class:comment-next-composer-ai-active={isAiPanelOpen || showInlineSuggestion || showSelectionTools}
  class:comment-next-composer-compact={compact}
  class="comment-next-composer"
  data-base-url={baseUrl}
  data-subject={subject}
  onsubmit={handleSubmit}
>
  {#if loading}
    <CommentNextSkeleton showAccountFields={showAccountBar} loggedIn={isLoggedIn} {enablePrivate} />
  {:else}
    {#if showHeader}
      <div class="comment-next-reply-composer-head">
        <span class="comment-next-reply-composer-target">
          <CommentNextIcon name="reply" size={14} />
          {#if replyToName}
            回复 <strong>@{replyToName}</strong>
          {:else}
            回复评论
          {/if}
        </span>
        <button type="button" class="comment-next-reply-composer-cancel" onclick={onCancel}>
          取消
        </button>
      </div>
    {/if}

    <CommentNextAccountFields
      visible={showAccountBar}
      loggedIn={isLoggedIn}
      avatarUrl={isLoggedIn ? currentUserAvatar : anonymousAvatarUrl}
      avatarAlt={isLoggedIn ? currentUserDisplayName : anonymousDisplayName}
      userDisplayName={currentUserDisplayName}
      displayName={anonymousDisplayName}
      email={anonymousEmail}
      website={anonymousWebsite}
      onChange={(values) => {
        anonymousDisplayName = values.displayName;
        anonymousEmail = values.email;
        anonymousWebsite = values.website;
      }}
      onEmailBlur={handleAnonymousEmailBlur}
    />

    <CommentNextEditor
      bind:this={editorRef}
      {placeholder}
      aiOpen={isAiPanelOpen}
      inlineSuggestion={showInlineSuggestion}
      selectionTools={showSelectionTools}
      {aiMode}
      suggestionText={aiSuggestionText}
      suggestionLoading={aiGenerating}
      aiAssistantName={resolvedAiAssistantName}
      aiAssistantMentionName={resolvedAiAssistantMentionName}
      aiMentionEnabled={aiWritingEnabled}
      {allowImages}
      topRounded={editorTopRounded}
      onChange={(html) => {
        editorHtml = html;
        pruneUnusedPendingImages(html);
        onChange(html);
      }}
      onImagePaste={handleImagePaste}
      onCommandMenuRequest={() => {
        if (!aiWritingEnabled) {
          return;
        }

        isAiPanelOpen = true;
        showInlineSuggestion = false;
        showSelectionTools = false;
      }}
      onCloseAiPanel={() => (isAiPanelOpen = false)}
      onAcceptSuggestion={handleAcceptAiSuggestion}
      onInsertSuggestion={handleInsertAiSuggestion}
      onRewriteSuggestion={handleRewriteAiSuggestion}
      onRejectSuggestion={closeAiSuggestion}
    />

    {#if externalCaptchaStarting || submitMessage}
      <CommentNextNotice
        compact={variant === "reply"}
        message={externalCaptchaStarting ? "正在启动安全验证..." : submitMessage}
        variant={externalCaptchaStarting ? "info" : submitMessageType}
      />
    {/if}

    {#if showFooter}
      <CommentNextFooter
        {compact}
        commandMenuOpen={isAiPanelOpen}
        loggedIn={isLoggedIn}
        {allowAnonymous}
        {enablePrivate}
        submitting={isSubmitting}
        submitDisabled={anonymousMissingRequired || externalCaptchaStarting}
        submitLabel={resolvedSubmitLabel}
        {loginLabel}
        aiLabel={resolvedAiLabel}
        aiAssistantName={resolvedAiAssistantName}
        {aiMode}
        aiLoading={aiGenerating}
        {variant}
        showAi={aiWritingEnabled}
        {showInsertTools}
        {showSubmitArea}
        {imageUploadEnabled}
        {imageUploading}
        {imageAccept}
        {emotePacks}
        emotePageSize={emoteConfig?.pageSize}
        onEmoteSelect={handleEmoteSelect}
        onImageUpload={handleImageUpload}
        onLogin={handleLogin}
        onCloseCommandMenu={() => {
          isAiPanelOpen = false;
        }}
        onCommandModeSelect={handleAiModeSelect}
        onToggleCommandMenu={() => {
          if (!aiWritingEnabled) {
            return;
          }
          isAiPanelOpen = !isAiPanelOpen;
          showInlineSuggestion = false;
          showSelectionTools = false;
        }}
      />
    {/if}

    <CommentNextCaptchaDialog
      open={captchaDialogOpen}
      {baseUrl}
      type={captchaType}
      {captchaConfig}
      image={captchaImage}
      value={captchaCode}
      refreshKey={captchaRefreshKey}
      error={captchaDialogError}
      submitting={isSubmitting}
      onChange={(value) => {
        captchaCode = value;
        if (value.trim()) {
          captchaDialogError = '';
        }
      }}
      onConfirm={handleCaptchaConfirm}
      onVerified={handleCaptchaVerified}
      onError={(message) => {
        externalCaptchaStarting = false;
        showSubmitMessage(message);
      }}
      onClose={() => {
        if (!isSubmitting) {
          captchaDialogError = '';
          externalCaptchaStarting = false;
          captchaDialogOpen = false;
        }
      }}
    />
  {/if}
</form>

<style>
  .comment-next-composer {
    --at-apply: relative box-border w-full overflow-visible border border-solid [border-color:var(--comment-next-border-color,#d5dde7)] rounded-[var(--comment-next-radius-lg,0.875rem)] [background:var(--comment-next-box-bg,transparent,var(--comment-next-bg-color,#ffffff))] text-[var(--comment-next-text-color,#172033)] shadow-[0_12px_30px_rgb(15_23_42_/_0.04),0_1px_0_rgb(255_255_255_/_0.48)_inset] transition-[border-color,box-shadow,transform] duration-140 ease-in-out;
    max-width: 100%;
    min-width: 0;
    font-family: var(
      --comment-next-font-family,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif
    );
  }

  .comment-next-reply-composer {
    --comment-next-editor-min-height: 7.5rem;
    --comment-next-editor-mobile-min-height: 6rem;
    --comment-next-editor-padding: 0.875rem 1rem 1rem;
    --comment-next-editor-mobile-padding: 0.875rem 1rem 1rem;
    --at-apply: [border-color:var(--comment-next-border-subtle-color,#e7ecf2)] shadow-none;
  }

  .comment-next-reply-composer:focus-within {
    --at-apply: [border-color:var(--comment-next-focus-border-color,#aeb9c6)] shadow-[0_0_0_2px_var(--comment-next-focus-shadow-color,rgb(59_130_246_/_0.14))];
  }

  .comment-next-composer:focus-within {
    --at-apply: [border-color:var(--comment-next-focus-border-color,#aeb9c6)] shadow-[0_14px_34px_rgb(15_23_42_/_0.05),0_0_0_3px_var(--comment-next-focus-shadow-color,rgb(59_130_246_/_0.14))];
  }

  .comment-next-composer-ai-active {
    --at-apply: [border-color:var(--comment-next-ai-border-color,rgb(191_219_254))];
  }

  .comment-next-composer-loading {
    --at-apply: pointer-events-none overflow-hidden;
  }

  .comment-next-reply-composer-head {
    --at-apply: flex min-h-10 items-center justify-between gap-3 border-b [border-bottom-style:var(--comment-next-divider-style,dashed)] [border-bottom-color:var(--comment-next-divider-color,#d4dde8)] px-3 py-1.5 text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[650];
  }

  .comment-next-reply-composer-target {
    --at-apply: inline-flex min-w-0 items-center gap-[0.35rem];
  }

  .comment-next-reply-composer-target strong {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))] font-[760];
  }

  .comment-next-reply-composer-cancel {
    --at-apply: cursor-pointer border-0 bg-transparent text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[650] font-inherit;
  }

  .comment-next-reply-composer-cancel:hover {
    --at-apply: text-[var(--comment-next-text-color,#172033)];
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-composer {
      --at-apply: transition-none;
    }
  }
</style>
