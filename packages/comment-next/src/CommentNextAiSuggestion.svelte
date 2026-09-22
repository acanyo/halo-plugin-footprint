<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';

const {
  mode = 'polish',
  text = '',
  loading = false,
  aiAssistantName = '评论助手',
  onAccept = () => {},
  onInsert = () => {},
  onRewrite = () => {},
  onReject = () => {},
}: {
  mode?: string;
  text?: string;
  loading?: boolean;
  aiAssistantName?: string;
  onAccept?: () => void;
  onInsert?: () => void;
  onRewrite?: () => void;
  onReject?: () => void;
} = $props();

const modeLabels: Record<string, string> = {
  polish: '润色',
  expand: '补充观点',
  question: '提问角度',
  reply: '生成回复',
  summary: '总结文章评论',
};
</script>

<section
  class:comment-next-ai-suggestion-loading={loading}
  class="comment-next-ai-suggestion"
  contenteditable="false"
  data-comment-next-transient="true"
  aria-label={`${aiAssistantName}建议`}
>
  <header class="comment-next-ai-suggestion-head">
    <div class="comment-next-ai-suggestion-title">
      <span class="comment-next-ai-suggestion-emblem" aria-hidden="true">
        <CommentNextIcon name={loading ? "loader" : "sparkle"} size={14} />
      </span>
      <div class="comment-next-ai-suggestion-title-copy">
        <span class="comment-next-ai-suggestion-kicker">{aiAssistantName}建议</span>
        <span class="comment-next-ai-suggestion-mode">{modeLabels[mode] ?? "写作建议"}</span>
      </div>
    </div>

    <div class="comment-next-ai-suggestion-tools">
      <span class="comment-next-ai-suggestion-status">
        {loading ? "生成中" : "可使用"}
      </span>
      <button
        class="comment-next-ai-suggestion-icon-button"
        type="button"
        aria-label={`关闭${aiAssistantName}建议`}
        disabled={loading}
        onclick={onReject}
      >
        <CommentNextIcon name="x" size={14} />
      </button>
    </div>
  </header>

  <p class="comment-next-ai-suggestion-copy">
    {loading ? "正在整理评论建议..." : text}
  </p>

  {#if !loading}
    <footer class="comment-next-ai-suggestion-actions">
      <button
        class="comment-next-ai-suggestion-primary"
        type="button"
        disabled={!text}
        onclick={onAccept}
      >
        <CommentNextIcon name="check" size={14} />
        接受
      </button>
      <button type="button" disabled={!text} onclick={onInsert}>插入</button>
      <button type="button" onclick={onRewrite}>
        <CommentNextIcon name="refresh" size={13} />
        重写
      </button>
    </footer>
  {/if}
</section>

<style>
  .comment-next-ai-suggestion {
    --comment-next-ai-flow-border: linear-gradient(110deg,#60a5fa 0%,#8b5cf6 28%,#d946ef 52%,#93c5fd 76%,#60a5fa 100%);
    --comment-next-ai-flow-surface: linear-gradient(120deg,rgb(96_165_250_/_0.12),rgb(139_92_246_/_0.08),rgb(217_70_239_/_0.12),rgb(255_255_255_/_0) 72%);
    --at-apply: relative mt-3 box-border max-w-150 overflow-hidden rounded-[0.75rem] border border-solid border-transparent px-3 py-2.5 text-[var(--comment-next-text-color,#172033)] shadow-[0_12px_30px_rgb(59_130_246_/_0.12),0_1px_0_rgb(255_255_255_/_0.82)_inset];
    isolation: isolate;
    background:
      linear-gradient(var(--comment-next-menu-bg-color,#ffffff),var(--comment-next-menu-bg-color,#ffffff)) padding-box,
      var(--comment-next-ai-flow-border) border-box;
    background-size: 100% 100%, 260% 260%;
    background-position: 0 0, 0% 50%;
    animation:
      comment-next-suggestion-in 150ms cubic-bezier(0.2, 0.8, 0.2, 1),
      comment-next-ai-flow-border 5.6s linear infinite;
  }

  .comment-next-ai-suggestion::before {
    --at-apply: absolute inset-0 pointer-events-none;
    content: "";
    z-index: -1;
    background: var(--comment-next-ai-flow-surface);
    background-size: 230% 230%;
    background-position: 0% 50%;
    animation: comment-next-ai-flow-surface 6.8s ease-in-out infinite;
  }

  .comment-next-ai-suggestion-loading {
    --at-apply: shadow-[0_14px_36px_rgb(99_102_241_/_0.18),0_1px_0_rgb(255_255_255_/_0.86)_inset];
  }

  .comment-next-ai-suggestion-head,
  .comment-next-ai-suggestion-title,
  .comment-next-ai-suggestion-tools,
  .comment-next-ai-suggestion-actions {
    --at-apply: flex items-center;
  }

  .comment-next-ai-suggestion-head {
    --at-apply: justify-between gap-3;
  }

  .comment-next-ai-suggestion-title {
    --at-apply: min-w-0 gap-2;
  }

  .comment-next-ai-suggestion-emblem {
    --at-apply: inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[var(--comment-next-ai-bg-color,rgb(239_246_255))] text-[var(--comment-next-ai-color,rgb(59,130,246))];
  }

  .comment-next-ai-suggestion-loading .comment-next-ai-suggestion-emblem :global(.comment-next-icon) {
    --at-apply: animate-spin;
  }

  .comment-next-ai-suggestion-title-copy {
    --at-apply: min-w-0;
  }

  .comment-next-ai-suggestion-kicker {
    --at-apply: block truncate text-xs text-[var(--comment-next-ai-color,rgb(59,130,246))] font-[760] leading-tight;
  }

  .comment-next-ai-suggestion-mode {
    --at-apply: mt-0.5 block truncate text-sm text-[var(--comment-next-text-color,#172033)] font-[760] leading-tight;
  }

  .comment-next-ai-suggestion-tools {
    --at-apply: flex-none gap-1.5;
  }

  .comment-next-ai-suggestion-status {
    --at-apply: rounded-md bg-[var(--comment-next-toolbar-bg-color,#f6f8fb)] px-1.5 py-[0.1875rem] text-xs text-[var(--comment-next-muted-color,#667085)] font-[650];
  }

  .comment-next-ai-suggestion-icon-button {
    --at-apply: inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-[var(--comment-next-muted-color,#667085)] font-inherit transition-[background-color,color,transform] duration-140 ease-in-out;
  }

  .comment-next-ai-suggestion-icon-button:hover {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-ai-suggestion-icon-button:active {
    --at-apply: scale-94;
  }

  .comment-next-ai-suggestion-icon-button:disabled {
    --at-apply: cursor-wait opacity-45;
  }

  .comment-next-ai-suggestion-copy {
    --at-apply: mt-2 mb-0 ml-9 mr-0 whitespace-pre-wrap text-[0.9375rem] text-[var(--comment-next-text-color,#172033)] leading-[1.65];
  }

  .comment-next-ai-suggestion-loading .comment-next-ai-suggestion-copy {
    --at-apply: text-[var(--comment-next-muted-color,#667085)];
  }

  .comment-next-ai-suggestion-actions {
    --at-apply: mt-2.5 gap-1.5 pl-9;
  }

  .comment-next-ai-suggestion-actions button {
    --at-apply: inline-flex h-7 cursor-pointer items-center justify-center gap-[0.3125rem] rounded-lg border border-solid border-transparent bg-transparent px-2.5 py-0 text-[0.8125rem] text-[var(--comment-next-muted-color,#667085)] font-[620] font-inherit transition-[background-color,border-color,color,transform] duration-140 ease-in-out;
  }

  .comment-next-ai-suggestion-actions button:hover {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-text-color,#172033)];
  }

  .comment-next-ai-suggestion-actions button:active {
    --at-apply: translate-y-px;
  }

  .comment-next-ai-suggestion-actions button:disabled {
    --at-apply: cursor-not-allowed opacity-45;
  }

  .comment-next-ai-suggestion-actions .comment-next-ai-suggestion-primary {
    --at-apply: border-transparent bg-[var(--comment-next-primary-color,rgb(59,130,246))] text-white shadow-[0_6px_14px_rgb(59_130_246_/_0.18)];
  }

  .comment-next-ai-suggestion-actions .comment-next-ai-suggestion-primary:hover {
    --at-apply: bg-[var(--comment-next-primary-hover-color,rgb(37_99_235))] text-white;
  }

  .comment-next-ai-suggestion-actions button:focus-visible,
  .comment-next-ai-suggestion-icon-button:focus-visible {
    --at-apply: outline-2 outline-solid outline-offset-2 [outline-color:var(--comment-next-focus-ring-color,#80cbc0)];
  }

  @keyframes comment-next-suggestion-in {
    from {
      opacity: 0;
      transform: translateY(0.25rem);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes comment-next-ai-flow-border {
    to {
      background-position: 0 0, 260% 50%;
    }
  }

  @keyframes comment-next-ai-flow-surface {
    50% {
      background-position: 100% 50%;
    }

    to {
      background-position: 0% 50%;
    }
  }

  @media (max-width: 640px) {
    .comment-next-ai-suggestion {
      --at-apply: max-w-none px-3 py-2.5;
    }

    .comment-next-ai-suggestion-copy,
    .comment-next-ai-suggestion-actions {
      --at-apply: ml-0 pl-0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-ai-suggestion,
    .comment-next-ai-suggestion-actions button,
    .comment-next-ai-suggestion-icon-button,
    .comment-next-ai-suggestion-loading .comment-next-ai-suggestion-emblem :global(.comment-next-icon) {
      --at-apply: animate-none transition-none;
    }

    .comment-next-ai-suggestion::before {
      --at-apply: animate-none;
    }
  }
</style>
