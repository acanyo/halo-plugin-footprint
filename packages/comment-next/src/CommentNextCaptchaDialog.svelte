<script lang="ts">
import { tick } from 'svelte';
import CommentNextIcon from './CommentNextIcon.svelte';
import CommentNextImageCaptcha from './CommentNextImageCaptcha.svelte';
import {
  getAltchaChallengeUrl,
  isLocalImageCaptcha,
  resolveApiUrl,
  type CommentNextCaptchaConfig,
  type CommentNextCaptchaType,
} from './services/captcha';

type GeeTestInstance = {
  appendTo: (element: HTMLElement) => void;
  showCaptcha?: () => void;
  showCAPTCHA?: () => void;
  onReady: (callback: () => void) => GeeTestInstance;
  onSuccess: (callback: () => void) => GeeTestInstance;
  onError: (callback: () => void) => GeeTestInstance;
  getValidate: () => Record<string, unknown> | undefined;
  reset?: () => void;
  destroy?: () => void;
};

type CaptchaWindow = Window &
  typeof globalThis & {
    initGeetest4?: (
      config: Record<string, unknown>,
      callback: (captcha: GeeTestInstance) => void
    ) => void;
  };

type AltchaWidgetElement = HTMLElement & {
  configure?: (config: Record<string, unknown>) => Promise<void>;
  reset?: () => void;
  verify?: (options?: { minDuration?: number }) => Promise<{ payload: string } | null>;
};

type CapWidgetElement = HTMLElement & {
  reset?: () => void;
  token?: string | null;
};

const GEETEST_SCRIPT = 'https://static.geetest.com/v4/gt4.js';
const PLUGIN_STATIC_BASE = '/plugins/PluginCommentNext/assets/static';
const ALTCHA_SCRIPT = `${PLUGIN_STATIC_BASE}/vendor/altcha/altcha.i18n.min.js`;
const CAP_SCRIPT = `${PLUGIN_STATIC_BASE}/vendor/cap/cap.min.js`;

const scriptPromises = new Map<string, Promise<void>>();

const {
  open = false,
  baseUrl = '',
  type = 'ALPHANUMERIC',
  captchaConfig,
  image = '',
  value = '',
  refreshKey = 0,
  error = '',
  submitting = false,
  onChange = () => {},
  onConfirm = () => {},
  onVerified = () => {},
  onError = () => {},
  onClose = () => {},
}: {
  open?: boolean;
  baseUrl?: string;
  type?: CommentNextCaptchaType;
  captchaConfig?: CommentNextCaptchaConfig;
  image?: string;
  value?: string;
  refreshKey?: number;
  error?: string;
  submitting?: boolean;
  onChange?: (value: string) => void;
  onConfirm?: () => void;
  onVerified?: (value: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
} = $props();

let geeTestElement = $state<HTMLDivElement | undefined>();
let altchaElement = $state<AltchaWidgetElement | undefined>();
let capElement = $state<CapWidgetElement | undefined>();
let providerLoading = $state(false);
let providerReady = $state(false);
let providerError = $state('');
let geeTestInstance: GeeTestInstance | undefined;
let altchaVerifiedListener: ((event: Event) => void) | undefined;
let altchaStateChangeListener: ((event: Event) => void) | undefined;
let capSolveListener: ((event: Event) => void) | undefined;
let capErrorListener: ((event: Event) => void) | undefined;
let lastSessionKey = $state('');
let geeTestStyleSyncTimers: number[] = [];
let altchaStyleSyncTimers: number[] = [];

const localImageMode = $derived(isLocalImageCaptcha(type));
const externalProviderMode = $derived(!localImageMode);
const canConfirm = $derived(Boolean(value.trim()) && !submitting);
const dialogDescription = $derived(resolveDialogDescription());
const resolvedError = $derived(providerError || error.trim());

$effect(() => {
  if (!open) {
    cleanupProviderWidgets();
    return;
  }

  const sessionKey = `${type}:${refreshKey}`;
  if (lastSessionKey !== sessionKey) {
    lastSessionKey = sessionKey;
    providerError = '';
    providerReady = false;
    cleanupProviderWidgets();
    onChange('');
  }
});

$effect(() => {
  if (!open || type !== 'GEETEST' || !geeTestElement) {
    return;
  }

  const currentRefreshKey = refreshKey;
  let cancelled = false;
  void currentRefreshKey;
  void renderGeeTest(() => cancelled);
  return () => {
    cancelled = true;
    cleanupGeeTest();
  };
});

$effect(() => {
  if (!open || type !== 'ALTCHA' || !altchaElement) {
    return;
  }

  const currentRefreshKey = refreshKey;
  let cancelled = false;
  void currentRefreshKey;
  void renderAltcha(() => cancelled);
  return () => {
    cancelled = true;
    cleanupAltcha();
  };
});

$effect(() => {
  if (!open || type !== 'CAP' || !capElement) {
    return;
  }

  const currentRefreshKey = refreshKey;
  let cancelled = false;
  void currentRefreshKey;
  void renderCap(() => cancelled);
  return () => {
    cancelled = true;
    cleanupCap();
  };
});

async function renderGeeTest(isCancelled: () => boolean) {
  const captchaId = captchaConfig?.geeTest?.captchaId?.trim();
  if (!captchaId) {
    reportProviderError('请先在后台配置 GeeTest Captcha ID。');
    return;
  }

  try {
    providerLoading = true;
    providerReady = false;
    providerError = '';
    await loadScript(GEETEST_SCRIPT);
    await tick();

    const initGeetest4 = captchaWindow().initGeetest4;
    if (isCancelled() || !geeTestElement || !initGeetest4) {
      providerLoading = false;
      return;
    }

    cleanupGeeTest();
    scheduleGeeTestStyleSync();
    const geeTestOptions: Record<string, unknown> = {
      captchaId,
      product: 'bind',
      language: 'zho',
    };
    const apiServers = resolveGeeTestApiServers(captchaConfig?.geeTest?.apiServer);
    if (apiServers) {
      geeTestOptions.apiServers = apiServers;
    }

    initGeetest4(
      geeTestOptions,
      (captcha: GeeTestInstance) => {
        if (isCancelled() || !geeTestElement) {
          captcha.destroy?.();
          return;
        }

        geeTestInstance = captcha;
        scheduleGeeTestStyleSync();
        captcha
          .onReady(() => {
            providerReady = true;
            providerLoading = false;
            scheduleGeeTestStyleSync();
            showGeeTestCaptcha(captcha);
          })
          .onSuccess(() => {
            scheduleGeeTestStyleSync();
            const validate = captcha.getValidate();
            if (!validate) {
              reportProviderError('GeeTest 未返回验证结果，请重新验证。');
              onChange('');
              return;
            }

            const token = JSON.stringify(validate);
            providerError = '';
            onChange(token);
            onVerified(token);
          })
          .onError(() => {
            reportProviderError('GeeTest 加载失败，请稍后重试。');
            onChange('');
          });
      }
    );
  } catch (error) {
    console.error(error);
    reportProviderError('GeeTest 加载失败，请稍后重试。');
    providerLoading = false;
  }
}

async function renderAltcha(isCancelled: () => boolean) {
  if (!altchaElement) {
    return;
  }

  try {
    providerLoading = true;
    providerReady = false;
    providerError = '';
    onChange('');
    await loadScript(resolveStaticAssetUrl(ALTCHA_SCRIPT));
    await tick();
    await waitForAltchaElement(altchaElement, isCancelled);
    scheduleAltchaStyleSync();
    if (isCancelled() || !altchaElement) {
      providerLoading = false;
      return;
    }

    const challengeUrl = getAltchaChallengeUrl(baseUrl);
    altchaElement.reset?.();
    await altchaElement.configure?.({
      auto: 'off',
      challenge: challengeUrl,
      credentials: 'include',
      display: 'standard',
      hideFooter: true,
      hideLogo: true,
      language: 'zh-cn',
      minDuration: 300,
    });

    if (isCancelled() || !altchaElement) {
      providerLoading = false;
      return;
    }

    attachAltchaListeners(altchaElement, isCancelled);
    scheduleAltchaStyleSync();
    providerReady = true;
    providerLoading = false;
  } catch (error) {
    console.error(error);
    providerLoading = false;
    reportProviderError('ALTCHA 验证失败，请稍后重试。');
    onChange('');
  }
}

async function renderCap(isCancelled: () => boolean) {
  const apiEndpoint = resolveCapApiEndpoint(captchaConfig?.cap?.apiEndpoint);
  if (!apiEndpoint || !capElement) {
    reportProviderError('请先在后台配置 Cap API Endpoint。');
    return;
  }

  try {
    providerLoading = true;
    providerReady = false;
    providerError = '';
    onChange('');
    cleanupCap();
    await loadScript(resolveStaticAssetUrl(CAP_SCRIPT));
    await waitForCapElement(capElement, isCancelled);
    if (isCancelled() || !capElement) {
      providerLoading = false;
      return;
    }

    configureCapElement(capElement, apiEndpoint);
    attachCapListeners(capElement, isCancelled);
    providerReady = true;
    providerLoading = false;
  } catch (error) {
    console.error(error);
    providerLoading = false;
    reportProviderError('Cap 验证失败，请稍后重试。');
    onChange('');
  }
}

function cleanupProviderWidgets() {
  cleanupGeeTest();
  cleanupAltcha();
  cleanupCap();
}

function captchaWindow(): CaptchaWindow {
  return window as CaptchaWindow;
}

function reportProviderError(message: string) {
  providerError = message;
  if (externalProviderMode) {
    onError(message);
  }
}

function showGeeTestCaptcha(captcha: GeeTestInstance) {
  if (captcha.showCaptcha) {
    captcha.showCaptcha();
    return;
  }

  if (captcha.showCAPTCHA) {
    captcha.showCAPTCHA();
    return;
  }

  reportProviderError('GeeTest 当前版本不支持弹出验证，请检查脚本配置。');
}

function handleLayerClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    onClose();
  }
}

function cleanupGeeTest() {
  clearGeeTestStyleSyncTimers();
  geeTestInstance?.destroy?.();
  geeTestInstance = undefined;
  if (geeTestElement) {
    geeTestElement.innerHTML = '';
  }
}

function cleanupAltcha() {
  clearAltchaStyleSyncTimers();
  cleanupAltchaListeners();
  altchaElement?.reset?.();
}

function cleanupCap() {
  cleanupCapListeners();
  capElement?.reset?.();
}

async function waitForAltchaElement(
  element: AltchaWidgetElement,
  isCancelled: () => boolean
) {
  await customElements.whenDefined('altcha-widget');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (typeof element.verify === 'function') {
      return;
    }
    if (isCancelled()) {
      return;
    }
    await delay(50);
  }
  throw new Error('ALTCHA widget is not ready');
}

function attachAltchaListeners(
  element: AltchaWidgetElement,
  isCancelled: () => boolean
) {
  cleanupAltchaListeners();
  altchaVerifiedListener = (event: Event) => {
    if (isCancelled()) {
      return;
    }
    const token = (event as CustomEvent<{ payload?: string }>).detail?.payload ?? '';
    if (!token) {
      reportProviderError('ALTCHA 未返回验证结果，请重新验证。');
      onChange('');
      return;
    }

    providerError = '';
    onChange(token);
    onVerified(token);
  };
  altchaStateChangeListener = (event: Event) => {
    if (isCancelled()) {
      return;
    }
    const state = (event as CustomEvent<{ state?: string }>).detail?.state;
    if (state === 'error') {
      reportProviderError('ALTCHA 验证失败，请重试。');
      onChange('');
    }
    if (state === 'expired') {
      reportProviderError('ALTCHA 验证已过期，请重新验证。');
      onChange('');
    }
  };
  element.addEventListener('verified', altchaVerifiedListener);
  element.addEventListener('statechange', altchaStateChangeListener);
}

function cleanupAltchaListeners() {
  if (altchaElement && altchaVerifiedListener) {
    altchaElement.removeEventListener('verified', altchaVerifiedListener);
  }
  if (altchaElement && altchaStateChangeListener) {
    altchaElement.removeEventListener('statechange', altchaStateChangeListener);
  }
  altchaVerifiedListener = undefined;
  altchaStateChangeListener = undefined;
}

async function waitForCapElement(
  element: CapWidgetElement,
  isCancelled: () => boolean
) {
  await customElements.whenDefined('cap-widget');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (typeof element.reset === 'function') {
      return;
    }
    if (isCancelled()) {
      return;
    }
    await delay(50);
  }
  throw new Error('Cap widget is not ready');
}

function configureCapElement(element: CapWidgetElement, apiEndpoint: string) {
  element.setAttribute('data-cap-api-endpoint', apiEndpoint);
  element.setAttribute('data-cap-i18n-initial-state', '点击开始安全验证');
  element.setAttribute('data-cap-i18n-verifying-label', '正在验证');
  element.setAttribute('data-cap-i18n-solved-label', '验证通过');
  element.setAttribute('data-cap-i18n-error-label', '验证失败，请重试');
  element.setAttribute('data-cap-i18n-verify-aria-label', '开始安全验证');
  element.setAttribute('data-cap-i18n-verifying-aria-label', '正在进行安全验证');
  element.setAttribute('data-cap-i18n-verified-aria-label', '安全验证已通过');
  element.setAttribute('data-cap-i18n-error-aria-label', '安全验证失败，请重试');
  element.setAttribute('data-cap-disable-haptics', '');
}

function attachCapListeners(element: CapWidgetElement, isCancelled: () => boolean) {
  cleanupCapListeners();
  capSolveListener = (event: Event) => {
    if (isCancelled()) {
      return;
    }
    const token = (event as CustomEvent<{ token?: string }>).detail?.token
      || element.token
      || '';
    if (!token) {
      reportProviderError('Cap 未返回验证结果，请重新验证。');
      onChange('');
      return;
    }

    providerError = '';
    onChange(token);
    onVerified(token);
  };
  capErrorListener = (event: Event) => {
    if (isCancelled()) {
      return;
    }
    const message = (event as CustomEvent<{ message?: string }>).detail?.message
      || 'Cap 验证失败，请重试。';
    reportProviderError(message);
    onChange('');
  };
  element.addEventListener('solve', capSolveListener);
  element.addEventListener('error', capErrorListener);
}

function cleanupCapListeners() {
  if (capElement && capSolveListener) {
    capElement.removeEventListener('solve', capSolveListener);
  }
  if (capElement && capErrorListener) {
    capElement.removeEventListener('error', capErrorListener);
  }
  capSolveListener = undefined;
  capErrorListener = undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function resolveGeeTestApiServers(apiServer: string | undefined): string[] | undefined {
  const value = apiServer?.trim();
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return [url.host];
  } catch {
    return [value.replace(/^https?:\/\//, '').replace(/\/$/, '')];
  }
}

function resolveCapApiEndpoint(apiEndpoint: string | undefined): string {
  const value = apiEndpoint?.trim();
  if (!value) {
    return '';
  }

  if (value.startsWith('/')) {
    return resolveApiUrl(baseUrl, value);
  }

  return value.endsWith('/') ? value : `${value}/`;
}

function resolveStaticAssetUrl(path: string): string {
  return resolveApiUrl(baseUrl, path);
}

function scheduleAltchaStyleSync() {
  clearAltchaStyleSyncTimers();
  [0, 50, 120, 300, 700, 1200].forEach((delay) => {
    altchaStyleSyncTimers.push(
      window.setTimeout(syncAltchaStylesIntoShadowRoots, delay)
    );
  });
}

function clearAltchaStyleSyncTimers() {
  altchaStyleSyncTimers.forEach((timer) => window.clearTimeout(timer));
  altchaStyleSyncTimers = [];
}

function syncAltchaStylesIntoShadowRoots() {
  if (!altchaElement) {
    return;
  }

  const sourceNode = document.querySelector<HTMLStyleElement>('#altcha-css');
  if (!sourceNode) {
    return;
  }

  const roots = [
    altchaElement.shadowRoot,
    altchaElement.getRootNode(),
  ].filter((root): root is ShadowRoot => root instanceof ShadowRoot);

  roots.forEach((root) => {
    if (root.querySelector('[data-comment-next-altcha-style="altcha-css"]')) {
      return;
    }

    const clonedNode = sourceNode.cloneNode(true) as HTMLStyleElement;
    clonedNode.setAttribute('data-comment-next-altcha-style', 'altcha-css');
    root.appendChild(clonedNode);
  });
}

function scheduleGeeTestStyleSync() {
  clearGeeTestStyleSyncTimers();
  [0, 80, 240, 600, 1200].forEach((delay) => {
    geeTestStyleSyncTimers.push(
      window.setTimeout(syncGeeTestStylesIntoShadowRoot, delay)
    );
  });
}

function clearGeeTestStyleSyncTimers() {
  geeTestStyleSyncTimers.forEach((timer) => window.clearTimeout(timer));
  geeTestStyleSyncTimers = [];
}

function syncGeeTestStylesIntoShadowRoot() {
  const root = geeTestElement?.getRootNode();
  if (!(root instanceof ShadowRoot)) {
    return;
  }

  const sourceNodes = Array.from(
    document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style, link[rel="stylesheet"]'
    )
  ).filter(isGeeTestStyleNode);

  sourceNodes.forEach((node, index) => {
    const key = geeTestStyleNodeKey(node, index);
    if (root.querySelector(`[data-comment-next-geetest-style="${key}"]`)) {
      return;
    }

    const clonedNode = node.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
    clonedNode.setAttribute('data-comment-next-geetest-style', key);
    root.appendChild(clonedNode);
  });
}

function isGeeTestStyleNode(node: HTMLStyleElement | HTMLLinkElement): boolean {
  if (node instanceof HTMLLinkElement) {
    return /geetest|gt4|captcha/i.test(node.href);
  }

  return /geetest|gt4|gt_|captcha/i.test(node.textContent ?? '');
}

function geeTestStyleNodeKey(
  node: HTMLStyleElement | HTMLLinkElement,
  index: number
): string {
  if (node instanceof HTMLLinkElement) {
    return `link-${hashString(node.href)}`;
  }

  return `style-${hashString(node.textContent ?? '')}-${index}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function resolveDialogDescription(): string {
  return '完成验证后继续提交';
}

function loadScript(src: string): Promise<void> {
  if (scriptPromises.has(src)) {
    return scriptPromises.get(src)!;
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`
  );
  if (existing) {
    const promise = Promise.resolve();
    scriptPromises.set(src, promise);
    return promise;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  scriptPromises.set(src, promise);
  return promise;
}
</script>

{#if open && localImageMode}
  <div class="comment-next-captcha-dialog-layer" role="presentation" onclick={handleLayerClick}>
    <div
      class="comment-next-captcha-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comment-next-captcha-title"
    >
      <header class="comment-next-captcha-dialog-header">
        <div>
          <h3 id="comment-next-captcha-title">安全验证</h3>
          <p>{dialogDescription}</p>
        </div>
        <button
          class="comment-next-captcha-dialog-close"
          type="button"
          aria-label="关闭验证码"
          disabled={submitting}
          onclick={onClose}
        >
          <CommentNextIcon name="x" size={16} />
        </button>
      </header>

      <div class="comment-next-captcha-dialog-body">
        <CommentNextImageCaptcha
          {baseUrl}
          {image}
          {refreshKey}
          {value}
          disabled={submitting}
          onChange={onChange}
        />

        {#if resolvedError}
          <p class="comment-next-captcha-dialog-error">{resolvedError}</p>
        {/if}
      </div>

      <footer class="comment-next-captcha-dialog-footer">
        <button
          class="comment-next-captcha-dialog-secondary"
          type="button"
          disabled={submitting}
          onclick={onClose}
        >
          取消
        </button>
        <button
          class="comment-next-captcha-dialog-primary"
          type="button"
          disabled={!canConfirm}
          onclick={onConfirm}
        >
          {#if submitting}
            <span class="comment-next-captcha-dialog-loading">
              <CommentNextIcon name="loader" size={15} />
            </span>
          {/if}
          继续提交
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if open && type === 'GEETEST'}
  <div bind:this={geeTestElement} class="comment-next-geetest-headless-host" aria-hidden="true"></div>
{/if}

{#if open && type === 'ALTCHA'}
  <div class="comment-next-captcha-dialog-layer" role="presentation" onclick={handleLayerClick}>
    <div
      class="comment-next-altcha-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comment-next-altcha-title"
    >
      <header class="comment-next-captcha-dialog-header">
        <div>
          <h3 id="comment-next-altcha-title">安全验证</h3>
          <p>点击完成验证后继续提交</p>
        </div>
        <button
          class="comment-next-captcha-dialog-close"
          type="button"
          aria-label="关闭验证码"
          disabled={submitting}
          onclick={onClose}
        >
          <CommentNextIcon name="x" size={16} />
        </button>
      </header>

      <div class="comment-next-altcha-dialog-body">
        <div class="comment-next-altcha-widget-shell" data-loading={providerLoading}>
          {#if providerLoading}
            <div class="comment-next-altcha-loading">
              <span class="comment-next-captcha-dialog-loading">
                <CommentNextIcon name="loader" size={16} />
              </span>
              正在加载安全验证...
            </div>
          {/if}
          <svelte:element
            this={'altcha-widget'}
            bind:this={altchaElement}
            class="comment-next-altcha-widget"
            auto="off"
            challenge={getAltchaChallengeUrl(baseUrl)}
            display="standard"
            language="zh-cn"
          />
        </div>

        {#if resolvedError}
          <p class="comment-next-captcha-dialog-error">{resolvedError}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if open && type === 'CAP'}
  <div class="comment-next-captcha-dialog-layer" role="presentation" onclick={handleLayerClick}>
    <div
      class="comment-next-cap-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comment-next-cap-title"
    >
      <header class="comment-next-captcha-dialog-header">
        <div>
          <h3 id="comment-next-cap-title">安全验证</h3>
          <p>点击完成验证后继续提交</p>
        </div>
        <button
          class="comment-next-captcha-dialog-close"
          type="button"
          aria-label="关闭验证码"
          disabled={submitting}
          onclick={onClose}
        >
          <CommentNextIcon name="x" size={16} />
        </button>
      </header>

      <div class="comment-next-cap-dialog-body">
        <div class="comment-next-cap-widget-shell" data-loading={providerLoading}>
          {#if providerLoading}
            <div class="comment-next-cap-loading">
              <span class="comment-next-captcha-dialog-loading">
                <CommentNextIcon name="loader" size={16} />
              </span>
              正在加载安全验证...
            </div>
          {/if}
          <svelte:element
            this={'cap-widget'}
            bind:this={capElement}
            class="comment-next-cap-widget"
            data-cap-api-endpoint={resolveCapApiEndpoint(captchaConfig?.cap?.apiEndpoint)}
            data-cap-i18n-initial-state="点击开始安全验证"
            data-cap-i18n-verifying-label="正在验证"
            data-cap-i18n-solved-label="验证通过"
            data-cap-i18n-error-label="验证失败，请重试"
            data-cap-i18n-verify-aria-label="开始安全验证"
            data-cap-i18n-verifying-aria-label="正在进行安全验证"
            data-cap-i18n-verified-aria-label="安全验证已通过"
            data-cap-i18n-error-aria-label="安全验证失败，请重试"
            data-cap-disable-haptics
          />
        </div>

        {#if resolvedError}
          <p class="comment-next-captcha-dialog-error">{resolvedError}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .comment-next-captcha-dialog-layer {
    --at-apply: fixed inset-0 z-[9999] flex items-center justify-center bg-[rgb(15_23_42_/_0.30)] px-4 py-6;
    backdrop-filter: blur(2px);
  }

  .comment-next-captcha-dialog {
    --at-apply: w-full max-w-[22rem] overflow-hidden rounded-[0.875rem] border border-solid [border-color:rgb(203_213_225_/_0.72)] bg-[var(--comment-next-surface-bg-color,#ffffff)] shadow-[0_22px_56px_rgb(15_23_42_/_0.18),0_1px_0_rgb(255_255_255_/_0.90)_inset];
  }

  .comment-next-cap-dialog,
  .comment-next-altcha-dialog {
    --at-apply: w-full max-w-[22rem] overflow-hidden rounded-[0.875rem] border border-solid [border-color:rgb(203_213_225_/_0.72)] bg-[var(--comment-next-surface-bg-color,#ffffff)] shadow-[0_22px_56px_rgb(15_23_42_/_0.18),0_1px_0_rgb(255_255_255_/_0.90)_inset];
  }

  .comment-next-captcha-dialog-header {
    --at-apply: flex items-start justify-between gap-3 px-5 pb-2 pt-4;
  }

  .comment-next-captcha-dialog-header h3 {
    --at-apply: m-0 text-[1.0625rem] leading-6 font-[760] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-captcha-dialog-header p {
    --at-apply: m-0 mt-1 text-[0.8125rem] leading-5 text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-captcha-dialog-close {
    --at-apply: inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[0.5rem] border-0 bg-transparent p-0 text-[var(--comment-next-muted-color,#6b7687)] transition-[background-color,color,transform] duration-140 ease-in-out;
  }

  .comment-next-captcha-dialog-close:hover {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-captcha-dialog-body {
    --at-apply: flex flex-col items-stretch gap-3 px-5 pb-4 pt-3;
  }

  .comment-next-cap-dialog-body,
  .comment-next-altcha-dialog-body {
    --at-apply: flex flex-col items-stretch gap-3 px-5 pb-5 pt-3;
  }

  .comment-next-cap-widget-shell,
  .comment-next-altcha-widget-shell {
    --at-apply: relative flex min-h-[58px] items-center justify-center;
  }

  .comment-next-cap-widget-shell[data-loading="true"] .comment-next-cap-widget {
    --at-apply: opacity-0;
  }

  .comment-next-altcha-widget-shell[data-loading="true"] .comment-next-altcha-widget {
    --at-apply: opacity-0;
  }

  .comment-next-cap-widget {
    --at-apply: max-w-full;
  }

  .comment-next-altcha-widget {
    --at-apply: w-full max-w-full;
    --altcha-max-width: 100%;
    --altcha-border-radius: 0.75rem;
    --altcha-color-primary: rgb(59 130 246);
  }

  .comment-next-cap-loading,
  .comment-next-altcha-loading {
    --at-apply: absolute inset-0 flex items-center justify-center gap-2 rounded-[0.875rem] border border-solid [border-color:rgb(226_232_240)] bg-[rgb(248_250_252)] text-sm text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-geetest-headless-host {
    --at-apply: fixed left-0 top-0 h-px w-px overflow-hidden opacity-0 pointer-events-none;
  }

  .comment-next-captcha-dialog-error {
    --at-apply: m-0 rounded-[0.625rem] bg-[rgb(254_242_242)] px-3 py-2 text-xs leading-5 text-[var(--comment-next-danger-color,#dc2626)];
  }

  .comment-next-captcha-dialog-footer {
    --at-apply: flex items-center justify-end gap-2 bg-[rgb(248_250_252_/_0.72)] px-5 py-3;
  }

  .comment-next-captcha-dialog-secondary,
  .comment-next-captcha-dialog-primary {
    --at-apply: inline-flex h-9 min-w-18 cursor-pointer items-center justify-center gap-1.5 rounded-[0.5625rem] border-0 px-3.5 text-sm font-[690] transition-[background-color,box-shadow,transform,opacity] duration-140 ease-in-out;
  }

  .comment-next-captcha-dialog-secondary {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-captcha-dialog-primary {
    --at-apply: bg-[var(--comment-next-primary-hover-color,rgb(59,130,246))] text-white shadow-[0_9px_18px_rgb(59_130_246_/_0.18)];
  }

  .comment-next-captcha-dialog-primary:not(:disabled):hover {
    --at-apply: shadow-[0_11px_22px_rgb(59_130_246_/_0.22)] -translate-y-px;
  }

  .comment-next-captcha-dialog-secondary:not(:disabled):hover {
    --at-apply: bg-[rgb(226_232_240)];
  }

  .comment-next-captcha-dialog-primary:disabled,
  .comment-next-captcha-dialog-secondary:disabled,
  .comment-next-captcha-dialog-close:disabled {
    --at-apply: cursor-not-allowed opacity-65;
  }

  .comment-next-captcha-dialog-loading {
    --at-apply: inline-flex animate-spin;
  }
</style>
