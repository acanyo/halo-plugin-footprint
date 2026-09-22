<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';
import type { CommentNextReportConfig } from './services/config';
import {
  submitReport,
  type CommentNextReportReason,
  type CommentNextReportTargetType,
} from './services/reports';
import { notifyCommentNextModalOpen } from './utils/overlays';
import { portalToBody } from './utils/portal';

const reasonOptions: Array<{
  value: CommentNextReportReason;
  label: string;
  description: string;
}> = [
  {
    value: 'SPAM',
    label: '垃圾灌水',
    description: '重复、无意义、刷屏内容',
  },
  {
    value: 'AD',
    label: '广告推广',
    description: '营销、引流、推广链接',
  },
  {
    value: 'ABUSE',
    label: '辱骂骚扰',
    description: '攻击、歧视、引战内容',
  },
  {
    value: 'PORN',
    label: '色情低俗',
    description: '成人、低俗或不适内容',
  },
  {
    value: 'ILLEGAL',
    label: '违法违规',
    description: '违法、诈骗、危险内容',
  },
  {
    value: 'OTHER',
    label: '其他问题',
    description: '不属于以上类型的问题',
  },
];

const {
  baseUrl = '',
  targetType,
  name,
  loggedIn = false,
  config,
  demoData = false,
  compact = false,
}: {
  baseUrl?: string;
  targetType: CommentNextReportTargetType;
  name: string;
  loggedIn?: boolean;
  config?: CommentNextReportConfig;
  demoData?: boolean;
  compact?: boolean;
} = $props();

let status = $state<'idle' | 'submitting' | 'reported' | 'error'>('idle');
let previousKey = $state('');
let dialogOpen = $state(false);
let dialogElement = $state<HTMLDialogElement | null>(null);
let reportReason = $state<CommentNextReportReason>('SPAM');
let reportDescription = $state('');
let errorMessage = $state('');

const targetEnabled = $derived(
  targetType === 'COMMENT'
    ? config?.commentEnabled !== false
    : config?.replyEnabled !== false
);
const enabled = $derived(Boolean(config?.enabled && targetEnabled && name));
const allowAnonymous = $derived(config?.allowAnonymous !== false);
const canReport = $derived(loggedIn || allowAnonymous);
const targetKey = $derived(`${baseUrl}|${targetType}|${name}`);
const label = $derived(
  status === 'submitting'
    ? '举报中'
    : status === 'reported'
      ? '已举报'
      : status === 'error'
        ? '举报失败'
        : '举报'
);
const title = $derived(
  canReport
    ? status === 'reported'
      ? '已收到举报'
      : '举报这条内容'
    : '请登录后举报'
);
const descriptionText = $derived(reportDescription.trim());
const canSubmit = $derived(
  canReport && status !== 'submitting' && descriptionText.length > 0
);

$effect(() => {
  if (previousKey !== targetKey) {
    previousKey = targetKey;
    status = 'idle';
    dialogOpen = false;
    reportReason = 'SPAM';
    reportDescription = '';
    errorMessage = '';
  }
});

$effect(() => {
  const element = dialogElement;
  if (!element) {
    return;
  }

  if (dialogOpen) {
    if (!element.open) {
      element.showModal();
    }
    return;
  }

  if (element.open) {
    element.close();
  }
});

function handleReport() {
  if (!canReport || status === 'submitting' || status === 'reported') {
    return;
  }

  errorMessage = '';
  notifyCommentNextModalOpen('report');
  dialogOpen = true;
}

function closeDialog() {
  if (status === 'submitting') {
    return;
  }

  dialogOpen = false;
  errorMessage = '';
  if (status === 'error') {
    status = 'idle';
  }
}

function handleDialogClick(event: MouseEvent) {
  if (event.target !== event.currentTarget || !(event.currentTarget instanceof HTMLDialogElement)) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const outsideDialog =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;

  if (outsideDialog) {
    closeDialog();
  }
}

function handleDialogCancel(event: Event) {
  if (status === 'submitting') {
    event.preventDefault();
    return;
  }

  dialogOpen = false;
}

function handleDialogClose() {
  if (dialogOpen) {
    dialogOpen = false;
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (dialogOpen && event.key === 'Escape') {
    closeDialog();
  }
}

async function submitReportForm() {
  if (!canSubmit) {
    if (!descriptionText.length) {
      errorMessage = '请填写举报原因。';
    }
    return;
  }

  status = 'submitting';
  errorMessage = '';

  try {
    if (!demoData) {
      await submitReport({
        baseUrl,
        targetType,
        name,
        reason: reportReason,
        description: descriptionText,
      });
    }
    status = 'reported';
    dialogOpen = false;
    reportDescription = '';
  } catch (error) {
    console.warn('Failed to report target', error);
    errorMessage = error instanceof Error ? error.message : '举报提交失败，请稍后再试。';
    status = 'error';
  }
}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if enabled}
  <span class="comment-next-report-button-wrap">
    <button
      class:comment-next-report-button-reported={status === "reported"}
      class:comment-next-report-button-error={status === "error"}
      class:comment-next-report-button-compact={compact}
      class="comment-next-report-button"
      type="button"
      disabled={!canReport || status === "submitting" || status === "reported"}
      aria-label={label}
      {title}
      onclick={handleReport}
    >
      <span
        class:comment-next-report-button-loading={status === "submitting"}
        class="comment-next-report-button-icon"
        aria-hidden="true"
      >
        <CommentNextIcon name={status === "submitting" ? "loader" : "circleAlert"} size={13} />
      </span>
      <span>{label}</span>
    </button>
  </span>

  {#if dialogOpen}
    <dialog
      use:portalToBody
      bind:this={dialogElement}
      class="comment-next-report-dialog-shell"
      aria-labelledby="comment-next-report-dialog-title"
      onclick={handleDialogClick}
      oncancel={handleDialogCancel}
      onclose={handleDialogClose}
    >
      <div
        class="comment-next-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-next-report-dialog-title"
      >
        <header class="comment-next-report-dialog-header">
          <div>
            <h3 id="comment-next-report-dialog-title">举报这条内容</h3>
            <p>请选择举报类型，并简单说明原因。</p>
          </div>
          <button
            class="comment-next-report-dialog-close"
            type="button"
            aria-label="关闭"
            disabled={status === "submitting"}
            onclick={closeDialog}
          >
            <CommentNextIcon name="x" size={16} />
          </button>
        </header>

        <div class="comment-next-report-reasons" role="radiogroup" aria-label="举报类型">
          {#each reasonOptions as option}
            <label
              class:comment-next-report-reason-active={reportReason === option.value}
              class="comment-next-report-reason"
            >
              <input
                type="radio"
                name={`comment-next-report-reason-${targetKey}`}
                value={option.value}
                bind:group={reportReason}
                disabled={status === "submitting"}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          {/each}
        </div>

        <label class="comment-next-report-description">
          <span>举报原因</span>
          <textarea
            bind:value={reportDescription}
            maxlength="500"
            rows="4"
            placeholder="请补充具体原因，方便管理员判断。"
            disabled={status === "submitting"}
          ></textarea>
        </label>

        <div class="comment-next-report-dialog-meta">
          <span>{reportDescription.length}/500</span>
          {#if errorMessage}
            <strong>{errorMessage}</strong>
          {/if}
        </div>

        <footer class="comment-next-report-dialog-actions">
          <button
            class="comment-next-report-dialog-cancel"
            type="button"
            disabled={status === "submitting"}
            onclick={closeDialog}
          >
            取消
          </button>
          <button
            class="comment-next-report-dialog-submit"
            type="button"
            disabled={!canSubmit}
            onclick={submitReportForm}
          >
            {#if status === "submitting"}
              <span class="comment-next-report-button-loading">
                <CommentNextIcon name="loader" size={14} />
              </span>
              提交中
            {:else}
              提交举报
            {/if}
          </button>
        </footer>
      </div>
    </dialog>
  {/if}
{/if}

<style>
  .comment-next-report-button-wrap {
    --at-apply: inline-flex items-center;
  }

  .comment-next-report-button {
    --at-apply: inline-flex h-6 min-w-0 box-border cursor-pointer items-center justify-start gap-1 border-0 rounded-none bg-transparent p-0 text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[680] font-inherit transition-[color,opacity,transform] duration-140 ease-in-out;
  }

  .comment-next-report-button:hover {
    --at-apply: text-[var(--comment-next-warning-color,#d97706)];
  }

  .comment-next-report-button:disabled {
    --at-apply: cursor-not-allowed opacity-64;
  }

  .comment-next-report-button-reported,
  .comment-next-report-button-reported:hover {
    --at-apply: text-[var(--comment-next-success-color,#15803d)];
  }

  .comment-next-report-button-error,
  .comment-next-report-button-error:hover {
    --at-apply: text-[var(--comment-next-error-color,#dc2626)];
  }

  .comment-next-report-button-compact {
    --at-apply: h-[1.375rem] text-xs font-[650];
  }

  .comment-next-report-button-loading {
    --at-apply: animate-spin;
  }

  .comment-next-report-button:active {
    --at-apply: translate-y-px;
  }

  .comment-next-report-dialog-shell {
    --at-apply: fixed inset-0 z-[2147483000] m-auto h-fit w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-visible border-0 bg-transparent p-0 text-[var(--comment-next-text-color,#172033)];
    box-sizing: border-box;
    isolation: isolate;
    font-family: var(
      --comment-next-dialog-font-family,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif
    );
    font-size: 14px;
    line-height: 1.5;
    letter-spacing: 0;
    text-transform: none;
    -webkit-font-smoothing: antialiased;
    text-rendering: auto;
  }

  .comment-next-report-dialog-shell::backdrop {
    background: rgb(15 23 42 / 0.38);
    backdrop-filter: blur(1px);
  }

  .comment-next-report-dialog-shell,
  .comment-next-report-dialog-shell *,
  .comment-next-report-dialog-shell *::before,
  .comment-next-report-dialog-shell *::after {
    box-sizing: border-box;
  }

  .comment-next-report-dialog-shell button,
  .comment-next-report-dialog-shell input,
  .comment-next-report-dialog-shell textarea {
    font: inherit;
    letter-spacing: 0;
    text-transform: none;
  }

  .comment-next-report-dialog-shell button,
  .comment-next-report-dialog-shell textarea {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
  }

  .comment-next-report-dialog {
    --at-apply: w-full box-border rounded-[8px] border border-solid bg-[var(--comment-next-bg-color,#fff)] p-4 shadow-[0_24px_60px_rgba(15,23,42,0.22)];
    border-color: var(--comment-next-border-subtle-color, #e7ecf2);
    color: var(--comment-next-text-color, #172033);
  }

  .comment-next-report-dialog-header {
    --at-apply: mb-3 flex items-start justify-between gap-3;
  }

  .comment-next-report-dialog-header h3 {
    --at-apply: m-0 text-base font-[780] leading-6;
  }

  .comment-next-report-dialog-header p {
    --at-apply: m-0 mt-0.5 text-xs text-[var(--comment-next-muted-color,#6b7687)] leading-5;
  }

  .comment-next-report-dialog-close {
    --at-apply: inline-flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-[var(--comment-next-muted-color,#6b7687)] transition-[background-color,color] duration-140;
    box-shadow: none;
  }

  .comment-next-report-dialog-close:hover {
    --at-apply: bg-[var(--comment-next-muted-bg-color,#f4f6f8)] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-report-reasons {
    --at-apply: grid grid-cols-2 gap-2;
  }

  .comment-next-report-reason {
    --at-apply: flex min-w-0 cursor-pointer items-start gap-2 rounded-[7px] border border-solid bg-transparent px-2.5 py-2 text-left transition-[border-color,background-color] duration-140;
    border-color: var(--comment-next-border-subtle-color, #e7ecf2);
  }

  .comment-next-report-reason:hover,
  .comment-next-report-reason-active {
    --at-apply: bg-[var(--comment-next-primary-soft-bg-color,rgba(59,130,246,0.08))];
    border-color: var(--comment-next-primary-color, rgb(59, 130, 246));
  }

  .comment-next-report-reason input[type="radio"] {
    --at-apply: mt-0.5 h-3.5 w-3.5 flex-none rounded-full border border-solid bg-[var(--comment-next-bg-color,#fff)] p-0 outline-none transition-[border-color,box-shadow,background-color] duration-140;
    appearance: none;
    -webkit-appearance: none;
    border-color: var(--comment-next-border-color, #d7dee8);
    box-shadow: 0 0 0 1px rgb(15 23 42 / 0.02);
  }

  .comment-next-report-reason input[type="radio"]:checked {
    border-color: var(--comment-next-primary-color, rgb(59, 130, 246));
    background:
      radial-gradient(
        circle at center,
        var(--comment-next-primary-color, rgb(59, 130, 246)) 0 42%,
        transparent 46%
      ),
      var(--comment-next-bg-color, #fff);
    box-shadow: 0 0 0 3px var(--comment-next-primary-ring-color, rgb(59 130 246 / 0.12));
  }

  .comment-next-report-reason input[type="radio"]:focus-visible {
    box-shadow: 0 0 0 3px var(--comment-next-primary-ring-color, rgb(59 130 246 / 0.16));
  }

  .comment-next-report-reason span {
    --at-apply: grid min-w-0 gap-0.5;
  }

  .comment-next-report-reason strong {
    --at-apply: text-[0.8125rem] font-[720] leading-5;
  }

  .comment-next-report-reason small {
    --at-apply: text-xs text-[var(--comment-next-muted-color,#6b7687)] leading-[1.15rem];
  }

  .comment-next-report-description {
    --at-apply: mt-3 grid gap-1.5;
  }

  .comment-next-report-description span {
    --at-apply: text-xs text-[var(--comment-next-muted-color,#6b7687)] font-[680];
  }

  .comment-next-report-description textarea {
    --at-apply: min-h-[6rem] w-full box-border resize-y rounded-[7px] border border-solid bg-[var(--comment-next-input-bg-color,#fff)] px-3 py-2 text-[0.875rem] text-[var(--comment-next-text-color,#172033)] font-inherit leading-6 outline-none transition-[border-color,box-shadow] duration-140;
    border-color: var(--comment-next-border-color, #d7dee8);
    box-shadow: none;
  }

  .comment-next-report-description textarea::placeholder {
    color: var(--comment-next-placeholder-color, #8b96a7);
    opacity: 1;
  }

  .comment-next-report-description textarea:focus {
    --at-apply: shadow-[0_0_0_3px_var(--comment-next-primary-ring-color,rgba(59,130,246,0.16))];
    border-color: var(--comment-next-primary-color, rgb(59, 130, 246));
  }

  .comment-next-report-dialog-meta {
    --at-apply: mt-1.5 flex min-h-5 items-center justify-between gap-3 text-xs text-[var(--comment-next-muted-color,#6b7687)];
  }

  .comment-next-report-dialog-meta strong {
    --at-apply: text-right text-[var(--comment-next-error-color,#dc2626)] font-[650];
  }

  .comment-next-report-dialog-actions {
    --at-apply: mt-4 flex justify-end gap-2;
  }

  .comment-next-report-dialog-actions button {
    --at-apply: inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-solid px-3.5 py-0 text-sm font-[700] font-inherit transition-[background-color,border-color,color,opacity] duration-140;
    box-shadow: none;
  }

  .comment-next-report-dialog-actions button:disabled {
    --at-apply: cursor-not-allowed opacity-60;
  }

  .comment-next-report-dialog-cancel {
    --at-apply: bg-transparent text-[var(--comment-next-muted-color,#6b7687)];
    border-color: var(--comment-next-border-color, #d7dee8);
  }

  .comment-next-report-dialog-cancel:hover {
    --at-apply: bg-[var(--comment-next-muted-bg-color,#f4f6f8)] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-report-dialog-submit {
    --at-apply: border-transparent bg-[var(--comment-next-primary-color,rgb(59,130,246))] text-white;
  }

  .comment-next-report-dialog-submit:hover {
    --at-apply: bg-[var(--comment-next-primary-hover-color,#2563eb)];
  }

  @media (max-width: 640px) {
    .comment-next-report-dialog-shell {
      --at-apply: inset-x-3 bottom-3 top-auto w-auto;
    }

    .comment-next-report-dialog {
      --at-apply: max-w-none p-3.5;
    }

    .comment-next-report-reasons {
      --at-apply: grid-cols-1;
    }

    .comment-next-report-dialog-actions {
      --at-apply: grid grid-cols-2;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-report-button,
    .comment-next-report-dialog,
    .comment-next-report-dialog-actions button,
    .comment-next-report-dialog-close,
    .comment-next-report-reason,
    .comment-next-report-button-loading {
      --at-apply: transition-none animate-none;
    }
  }
</style>
