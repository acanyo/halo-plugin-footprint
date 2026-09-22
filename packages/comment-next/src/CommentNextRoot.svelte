<script lang="ts">
import { onMount } from 'svelte';
import CommentNextBaseComposer from './CommentNextBaseComposer.svelte';
import CommentNextBox from './CommentNextBox.svelte';
import CommentNextCommentList from './CommentNextCommentList.svelte';
import CommentNextReactionBar from './CommentNextReactionBar.svelte';
import {
  normalizeCommentNextEmotePacks,
  normalizeLottieDefaults,
} from './emotes/normalize';
import {
  type CommentNextGlobalInfo,
  type CommentNextPluginConfig,
  fetchGlobalInfo,
  fetchPluginConfig,
} from './services/config';
import { fetchEmotePacks } from './services/emotes';
import type {
  CommentNextEmotePack,
  CommentNextRawEmotePacks,
} from './types/emote';
import { sanitizeCommentSubmitHtml, sanitizeConsoleCommentHtml } from './utils/html';
import { ensureLottieRuntimeLoaded } from './utils/lottie-content-adapter';

const {
  baseUrl = '',
  group = '',
  kind = '',
  version = 'v1alpha1',
  name = '',
  loggedIn = false,
  allowAnonymous = true,
  showCaptcha = false,
  enablePrivate = false,
  loading = false,
  submitting = false,
  commandMenuOpen = false,
  inlineSuggestion = false,
  selectionTools = false,
  placeholder = '写下你的评论...',
  editorOnly = false,
  allowImages = true,
  showAccountFields = true,
  showFooter = true,
  showSubmitArea = true,
  showComments = true,
  demoData = false,
  pageSize = 20,
  replySize = 10,
  withReplies = true,
  onEditorChange = () => {},
}: {
  baseUrl?: string;
  group?: string;
  kind?: string;
  version?: string;
  name?: string;
  loggedIn?: boolean;
  allowAnonymous?: boolean;
  showCaptcha?: boolean;
  enablePrivate?: boolean;
  loading?: boolean;
  submitting?: boolean;
  commandMenuOpen?: boolean;
  inlineSuggestion?: boolean;
  selectionTools?: boolean;
  placeholder?: string;
  editorOnly?: boolean;
  allowImages?: boolean;
  showAccountFields?: boolean;
  showFooter?: boolean;
  showSubmitArea?: boolean;
  showComments?: boolean;
  demoData?: boolean;
  pageSize?: number;
  replySize?: number;
  withReplies?: boolean;
  onEditorChange?: (html: string) => void;
} = $props();

type CommentNextComposerRef = {
  focus: () => void;
  reset: () => void;
};

let pluginConfig = $state<CommentNextPluginConfig | undefined>();
let globalInfo = $state<CommentNextGlobalInfo | undefined>();
let rawEmotePacks = $state<CommentNextRawEmotePacks>({});
// biome-ignore lint/style/useConst: Svelte assigns this through bind:this.
let editorComposerRef = $state<CommentNextComposerRef | undefined>();
let configLoaded = $state(false);
let configFailed = $state(false);
let globalInfoLoaded = $state(false);
let globalInfoFailed = $state(false);

const pluginConfigReady = $derived(demoData || configLoaded || configFailed);
const globalInfoReady = $derived(
  demoData || globalInfoLoaded || globalInfoFailed
);
const configReady = $derived(pluginConfigReady && globalInfoReady);
const basicConfig = $derived(pluginConfig?.basic);
const securityConfig = $derived(pluginConfig?.security);
const aiConfig = $derived(pluginConfig?.ai);
const uploadConfig = $derived(pluginConfig?.upload);
const reactionConfig = $derived(pluginConfig?.reaction);
const reportConfig = $derived(pluginConfig?.report);
const editorConfig = $derived(pluginConfig?.editor);
const badgeConfig = $derived(pluginConfig?.badge);
const emoteConfig = $derived(pluginConfig?.emote);
const resolvedAllowAnonymous = $derived(
  globalInfo?.allowAnonymousComments ?? allowAnonymous
);
const resolvedShowCaptcha = $derived(
  securityConfig?.captcha?.anonymousCommentCaptcha ?? showCaptcha
);
const resolvedCaptchaType = $derived(
  securityConfig?.captcha?.type ?? 'ALPHANUMERIC'
);
const resolvedEnablePrivate = $derived(
  basicConfig?.enablePrivateComment ?? enablePrivate
);
const resolvedShowCommenterDevice = $derived(
  basicConfig?.showCommenterDevice ?? true
);
const resolvedEnableImageLightbox = $derived(
  basicConfig?.enableImageLightbox ?? true
);
const resolvedPlaceholder = $derived(
  editorConfig?.placeholder?.trim() || placeholder
);
const resolvedLottieDefaultPaused = $derived(
  emoteConfig?.defaultPaused ?? true
);
const resolvedEmotePacks = $derived(
  applyLottiePlaybackDefaults(
    demoData
      ? normalizeCommentNextEmotePacks(undefined)
      : normalizeCommentNextEmotePacks(rawEmotePacks),
    resolvedLottieDefaultPaused
  )
);
const resolvedWithReplies = $derived(basicConfig?.withReplies ?? withReplies);
const resolvedPageSize = $derived(
  resolvePositiveNumber(basicConfig?.size, pageSize)
);
const resolvedReplySize = $derived(
  resolvePositiveNumber(
    resolvedWithReplies
      ? basicConfig?.withReplySize || basicConfig?.replySize
      : basicConfig?.replySize,
    replySize
  )
);

onMount(() => {
  if (demoData) {
    configLoaded = true;
    globalInfoLoaded = true;
    return;
  }

  let cancelled = false;

  if (editorOnly) {
    globalInfoLoaded = true;

    fetchPluginConfig(baseUrl)
      .then((config) => {
        if (!cancelled) {
          pluginConfig = config;
          configLoaded = true;
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          configFailed = true;
        }
      });

    fetchEmotePacks(baseUrl)
      .then((emotes) => {
        if (!cancelled) {
          ensureLottieRuntimeForEmotes(emotes);
          rawEmotePacks = emotes;
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          rawEmotePacks = {};
        }
      });

    return () => {
      cancelled = true;
    };
  }

  fetchPluginConfig(baseUrl)
    .then((config) => {
      if (!cancelled) {
        pluginConfig = config;
        configLoaded = true;
      }
    })
    .catch((error) => {
      console.error(error);
      if (!cancelled) {
        configFailed = true;
      }
    });

  fetchGlobalInfo(baseUrl)
    .then((info) => {
      if (!cancelled) {
        globalInfo = info;
        globalInfoLoaded = true;
      }
    })
    .catch((error) => {
      console.error(error);
      if (!cancelled) {
        globalInfoFailed = true;
      }
    });

  fetchEmotePacks(baseUrl)
    .then((emotes) => {
      if (!cancelled) {
        ensureLottieRuntimeForEmotes(emotes);
        rawEmotePacks = emotes;
      }
    })
    .catch((error) => {
      console.error(error);
      if (!cancelled) {
        rawEmotePacks = {};
      }
    });

  return () => {
    cancelled = true;
  };
});

function ensureLottieRuntimeForEmotes(emotes: unknown): void {
  if (!containsLottiePack(emotes)) {
    return;
  }

  ensureLottieRuntimeLoaded();
}

function containsLottiePack(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const packs = Array.isArray(record.packs)
    ? record.packs
    : Object.values(record);

  return packs.some((pack) => {
    if (!pack || typeof pack !== 'object') {
      return false;
    }

    const candidate = pack as { provider?: unknown; type?: unknown };
    return candidate.provider === 'LOTTIE' || candidate.type === 'lottie';
  });
}

function applyLottiePlaybackDefaults(
  packs: CommentNextEmotePack[],
  defaultPaused: boolean
): CommentNextEmotePack[] {
  return packs.map((pack) => {
    if (pack.provider !== 'LOTTIE') {
      return pack;
    }

    return {
      ...pack,
      items: pack.items.map((item) => ({
        ...item,
        defaults: {
          ...normalizeLottieDefaults(item.defaults),
          autoplay: !defaultPaused,
          hoverPlay: defaultPaused,
        },
      })),
    };
  });
}

function resolvePositiveNumber(
  value: number | undefined,
  fallback: number
): number {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return fallback;
  }

  return normalizedValue;
}

function handleEditorChange(html: string) {
  onEditorChange(
    allowImages
      ? sanitizeCommentSubmitHtml(html, emoteConfig?.allowedHosts)
      : sanitizeConsoleCommentHtml(html, emoteConfig?.allowedHosts)
  );
}

export function focus() {
  editorComposerRef?.focus();
}

export function reset() {
  editorComposerRef?.reset();
}
</script>

{#if editorOnly}
  <CommentNextBaseComposer
    bind:this={editorComposerRef}
    {baseUrl}
    {loggedIn}
    {allowImages}
    {showAccountFields}
    {showFooter}
    {showSubmitArea}
    allowAnonymous={false}
    showCaptcha={false}
    enablePrivate={false}
    loading={loading}
    {submitting}
    {commandMenuOpen}
    {inlineSuggestion}
    {selectionTools}
    placeholder={resolvedPlaceholder}
    {aiConfig}
    {uploadConfig}
    {emoteConfig}
    emotePacks={resolvedEmotePacks}
    variant="reply"
    compact
    targetReady={true}
    onChange={handleEditorChange}
  />
{:else}
  <div class="comment-next-root grid w-full gap-4">
    {#if configReady && reactionConfig?.enabled}
      <CommentNextReactionBar
        {baseUrl}
        {group}
        {kind}
        {version}
        {name}
        {loggedIn}
        config={reactionConfig}
      />
    {/if}

    <CommentNextBox
      {baseUrl}
      {group}
      {kind}
      {version}
      {name}
      {loggedIn}
      allowAnonymous={resolvedAllowAnonymous}
      showCaptcha={resolvedShowCaptcha}
      captchaType={resolvedCaptchaType}
      captchaConfig={securityConfig?.captcha}
      enablePrivate={resolvedEnablePrivate}
      loading={loading || !configReady}
      {submitting}
      {commandMenuOpen}
      {inlineSuggestion}
      {selectionTools}
      placeholder={resolvedPlaceholder}
      {aiConfig}
      {uploadConfig}
      {emoteConfig}
      emotePacks={resolvedEmotePacks}
    />

    {#if showComments && configReady}
      <CommentNextCommentList
        {baseUrl}
        {group}
        {kind}
        {version}
        {name}
        {loggedIn}
        allowAnonymous={resolvedAllowAnonymous}
        showCaptcha={resolvedShowCaptcha}
        captchaType={resolvedCaptchaType}
        captchaConfig={securityConfig?.captcha}
        {demoData}
        pageSize={resolvedPageSize}
        replySize={resolvedReplySize}
        withReplies={resolvedWithReplies}
        showCommenterDevice={resolvedShowCommenterDevice}
        enableImageLightbox={resolvedEnableImageLightbox}
        {badgeConfig}
        {aiConfig}
        {reactionConfig}
        {reportConfig}
        {uploadConfig}
        {emoteConfig}
        emotePacks={resolvedEmotePacks}
      />
    {/if}
  </div>
{/if}

<style>
  .comment-next-root {
    --at-apply: grid w-full gap-4;
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
  }
</style>
