import { fetchPluginConfig } from '../services/config';
import { upgradeLottieImages } from './lottie-html';

const LOTTIE_RUNTIME_URL = '/plugins/lottie/assets/lottie-runtime.js';
const RUNTIME_SCRIPT_MARKER = 'data-comment-next-lottie-runtime';
const ADAPTER_FLAG = '__commentNextLottieContentAdapterInstalled';

type PendingRoot = ParentNode;
const DEFAULT_RECENT_COMMENT_LOTTIE_MAX_SIZE = 100;

/**
 * Theme sidebars render comment HTML outside the widget shadow root. Observe
 * the light DOM so those server-rendered or asynchronously appended comments
 * receive the same Lottie custom element treatment as widget comments.
 */
export function installLottieContentAdapter(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const globalWindow = window as Window & {
    [ADAPTER_FLAG]?: boolean;
  };
  if (globalWindow[ADAPTER_FLAG]) {
    return;
  }
  globalWindow[ADAPTER_FLAG] = true;

  let allowedLottieHosts: readonly unknown[] = [];
  let recentCommentLottieMaxSize = DEFAULT_RECENT_COMMENT_LOTTIE_MAX_SIZE;
  let lottieConfigurationLoaded = false;
  let scanQueued = false;
  const pendingRoots: PendingRoot[] = [];

  const start = () => {
    void loadLottieConfiguration();

    if (!document.documentElement || typeof MutationObserver === 'undefined') {
      return;
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            queueScan(node as ParentNode);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  function queueScan(root: PendingRoot): void {
    pendingRoots.push(root);
    if (scanQueued) {
      return;
    }

    scanQueued = true;
    const flush = () => {
      scanQueued = false;
      const roots = pendingRoots.splice(0);
      for (const pendingRoot of roots) {
        scan(pendingRoot);
      }
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
    } else {
      window.setTimeout(flush, 0);
    }
  }

  function scan(root: ParentNode): void {
    if (!lottieConfigurationLoaded) {
      return;
    }

    if (
      upgradeLottieImages(root, allowedLottieHosts, {
        maxWidth: recentCommentLottieMaxSize,
        maxHeight: recentCommentLottieMaxSize,
      })
    ) {
      ensureLottieRuntimeLoaded();
    }
  }

  async function loadLottieConfiguration(): Promise<void> {
    try {
      const config = await fetchPluginConfig();
      allowedLottieHosts = config.emote?.allowedHosts ?? [];
      recentCommentLottieMaxSize = normalizeRecentCommentLottieMaxSize(
        config.emote?.recentCommentMaxSize
      );
      lottieConfigurationLoaded = true;
      scan(document);
    } catch {
      // The sidebar still supports same-origin Lottie content when config is unavailable.
      lottieConfigurationLoaded = true;
      scan(document);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

function normalizeRecentCommentLottieMaxSize(
  value: number | undefined
): number {
  const size = Number(value);
  return Number.isFinite(size) && size > 0
    ? Math.floor(size)
    : DEFAULT_RECENT_COMMENT_LOTTIE_MAX_SIZE;
}

/**
 * Load plugin-lottie's custom-element runtime when comment HTML contains a
 * Lottie element. The runtime upgrades elements that were inserted before the
 * module finished loading, so this is safe to call after rendering content.
 */
export function ensureLottieRuntimeLoaded(): void {
  if (
    typeof document === 'undefined' ||
    typeof customElements === 'undefined' ||
    customElements.get('halo-lottie')
  ) {
    return;
  }

  const hasRuntimeScript = Array.from(
    document.querySelectorAll('script[src]')
  ).some((script) => {
    try {
      return (
        new URL(script.getAttribute('src') ?? '', document.baseURI).pathname ===
        LOTTIE_RUNTIME_URL
      );
    } catch {
      return false;
    }
  });
  if (hasRuntimeScript) {
    return;
  }

  const script = document.createElement('script');
  script.type = 'module';
  script.src = LOTTIE_RUNTIME_URL;
  script.async = true;
  script.setAttribute(RUNTIME_SCRIPT_MARKER, 'true');
  document.head.appendChild(script);
}
