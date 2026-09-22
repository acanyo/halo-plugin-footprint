<!--
  未寄出的明信片：为一张票根生成可下载/分享的竖版明信片。

  绘制逻辑在 utils/postcard.ts（逐字迁移的手写 canvas，不引截图库——
  输出要与旧版像素级一致）。本组件只管三种状态与下载/分享动作。
-->
<svelte:options customElement={{ tag: 'footprint-postcard' }} />

<script lang="ts">
import { fade } from 'svelte/transition';
import type { Footprint } from '../types/footprint';
import { canvasToBlob, drawPostcard } from '../utils/postcard';
import { applyImageRule, normalizeAttachmentUrl } from '../utils/image';
import { store } from '../stores/footprint.svelte';

// 注意不要把变量命名为 state：Svelte 5 中 `let state = $state(...)` 会与 $state
// rune 产生 TDZ 冲突，报「Block-scoped variable '$state' used before its
// declaration」，错误信息完全指不到真正的原因。
type Phase = 'loading' | 'ready' | 'error';

let open = $state(false);
let phase = $state<Phase>('loading');
let footprint = $state<Footprint | null>(null);
let blobUrl = $state('');
let fileName = $state('');

/**
 * 渲染令牌：生成过程是异步的（加载图片 + toBlob），
 * 关闭浮层或换一张票后，本次结果必须作废，否则会把旧图盖到新页面上。
 * 这是原实现的处理，保留。
 */
let token = 0;

export function show(fp: Footprint) {
  footprint = fp;
  open = true;
  void render();
}

export function close() {
  open = false;
  footprint = null;
  revoke();
}

function revoke() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = '';
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    // 票根图可能来自图床，跨域时 canvas 会被污染导致 toBlob 抛错；
    // 显式声明匿名跨域，服务端不支持时 onerror 走占位分支，不会整个失败。
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function render() {
  const fp = footprint;
  if (!fp) return;
  const mine = ++token;
  phase = 'loading';
  revoke();

  try {
    const url = applyImageRule(
      normalizeAttachmentUrl(fp.spec.ticketImage),
      store.config,
      'timeline'
    );
    const image = await loadImage(url);
    if (mine !== token) return; // 已被新的请求取代

    const canvas = drawPostcard({ footprint: fp, image });
    const blob = await canvasToBlob(canvas);
    if (mine !== token) return;

    if (!blob) {
      phase = 'error';
      return;
    }
    blobUrl = URL.createObjectURL(blob);
    fileName = `${fp.spec.city || '旅行'}-${fp.spec.name || '明信片'}.png`;
    phase = 'ready';
  } catch (e) {
    if (mine !== token) return;
    console.error('[footprint-postcard] 生成失败', e);
    phase = 'error';
  }
}

function download() {
  if (!blobUrl) return;
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  a.click();
}

async function share() {
  if (!blobUrl) return;
  try {
    const blob = await fetch(blobUrl).then((r) => r.blob());
    const file = new File([blob], fileName, { type: 'image/png' });
    // 不是所有浏览器都支持分享文件，不支持就退回下载
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      download();
    }
  } catch {
    download();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (open && e.key === 'Escape') close();
}
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-[var(--footprint-z-lightbox)] flex flex-col items-center justify-center gap-4 bg-black/80 p-6"
    transition:fade={{ duration: 160 }}
    role="dialog"
    aria-modal="true"
    aria-label="未寄出的明信片"
    aria-busy={phase === 'loading'}
  >
    {#if phase === 'loading'}
      <div class="h-[60vh] w-[min(42vh,90vw)] animate-pulse rounded-[var(--footprint-radius)] bg-white/10"></div>
      <p class="text-sm text-white/70">正在写这封信…</p>
    {:else if phase === 'error'}
      <p class="text-sm text-white/75">这封信没能生成，可能是票根图取不到。</p>
      <button class="rounded border border-white/35 px-4 py-1.5 text-sm text-white" onclick={render}>
        重新生成
      </button>
    {:else}
      <img
        src={blobUrl}
        alt="明信片预览"
        class="max-h-[74vh] rounded-[var(--footprint-radius)] shadow-[var(--footprint-shadow-md)]"
      />
      <div class="flex gap-2">
        <button class="rounded border border-white/35 px-4 py-1.5 text-sm text-white" onclick={download}>
          下载
        </button>
        <button class="rounded border border-white/35 px-4 py-1.5 text-sm text-white" onclick={share}>
          分享
        </button>
      </div>
    {/if}

    <button class="absolute right-5 top-5 text-white/70 hover:text-white" aria-label="关闭" onclick={close}>
      ✕
    </button>
  </div>
{/if}
