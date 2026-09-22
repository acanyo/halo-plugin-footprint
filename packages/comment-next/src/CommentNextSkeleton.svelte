<script lang="ts">
const {
  showAccountFields = true,
  loggedIn = false,
  enablePrivate = false,
}: {
  showAccountFields?: boolean;
  loggedIn?: boolean;
  enablePrivate?: boolean;
} = $props();

const editorRows = ['72%', '48%', '64%'];
const accountRows = ['4rem', '4.25rem', '3.75rem'];
const tools = Array.from({ length: 2 });
</script>

<div class="comment-next-skeleton" aria-busy="true" aria-label="评论框加载中">
  {#if showAccountFields}
    <div class:comment-next-skeleton-fields-logged-in={loggedIn} class="comment-next-skeleton-fields">
      <span class="comment-next-skeleton-account-avatar"></span>
      {#if loggedIn}
        <span class="comment-next-skeleton-current-user">
          <span class="comment-next-skeleton-field-line" style="width: 4rem"></span>
          <span class="comment-next-skeleton-field-line" style="width: 8rem"></span>
        </span>
      {:else}
        {#each accountRows as width}
          <span class="comment-next-skeleton-field">
            <span class="comment-next-skeleton-field-icon"></span>
            <span class="comment-next-skeleton-field-line" style={`width: ${width}`}></span>
          </span>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="comment-next-skeleton-editor">
    <div class="comment-next-skeleton-topline">
      <span class="comment-next-skeleton-dot"></span>
      <span class="comment-next-skeleton-bar comment-next-skeleton-bar-short"></span>
    </div>
    <div class="comment-next-skeleton-lines">
      {#each editorRows as width}
        <span class="comment-next-skeleton-bar" style={`width: ${width}`}></span>
      {/each}
    </div>
  </div>

  <div class="comment-next-skeleton-footer">
    <div class="comment-next-skeleton-tools">
      <span class="comment-next-skeleton-ai-action"></span>
      {#each tools as _}
        <span class="comment-next-skeleton-tool"></span>
      {/each}
    </div>
    <div class="comment-next-skeleton-actions">
      {#if enablePrivate}
        <span class="comment-next-skeleton-chip"></span>
      {/if}
      <span class="comment-next-skeleton-submit"></span>
    </div>
  </div>
</div>

<style>
  .comment-next-skeleton {
    --at-apply: overflow-hidden rounded-[var(--comment-next-radius-lg,0.75rem)] bg-[var(--comment-next-bg-color,#ffffff)];
  }

  .comment-next-skeleton-editor {
    --at-apply: box-border min-h-[var(--comment-next-editor-min-height,12.5rem)] [background:var(--comment-next-skeleton-editor-bg,linear-gradient(180deg,rgb(251_253_253_/_0.94),rgb(255_255_255_/_0.96)),var(--comment-next-editor-bg-color,#ffffff))] p-[1.125rem];
  }

  .comment-next-skeleton-topline,
  .comment-next-skeleton-fields,
  .comment-next-skeleton-footer,
  .comment-next-skeleton-tools,
  .comment-next-skeleton-actions {
    --at-apply: flex items-center;
  }

  .comment-next-skeleton-topline {
    --at-apply: gap-2;
  }

  .comment-next-skeleton-lines {
    --at-apply: mt-6 grid gap-2.5;
  }

  .comment-next-skeleton-bar,
  .comment-next-skeleton-dot,
  .comment-next-skeleton-field-icon,
  .comment-next-skeleton-field-line,
  .comment-next-skeleton-account-avatar,
  .comment-next-skeleton-ai-action,
  .comment-next-skeleton-tool,
  .comment-next-skeleton-chip,
  .comment-next-skeleton-submit {
    --at-apply: relative overflow-hidden bg-[var(--comment-next-skeleton-base-color,#edf2f5)];
  }

  .comment-next-skeleton-bar::after,
  .comment-next-skeleton-dot::after,
  .comment-next-skeleton-field-icon::after,
  .comment-next-skeleton-field-line::after,
  .comment-next-skeleton-account-avatar::after,
  .comment-next-skeleton-ai-action::after,
  .comment-next-skeleton-tool::after,
  .comment-next-skeleton-chip::after,
  .comment-next-skeleton-submit::after {
    --at-apply: absolute inset-0 [background:linear-gradient(90deg,transparent,var(--comment-next-skeleton-highlight-color,rgb(255_255_255_/_0.78)),transparent)] -translate-x-full;
    animation: comment-next-skeleton-shimmer 1.35s ease-in-out infinite;
    content: "";
  }

  .comment-next-skeleton-dot {
    --at-apply: h-7 w-7 rounded-full;
  }

  .comment-next-skeleton-bar {
    --at-apply: block h-3 rounded-full;
  }

  .comment-next-skeleton-bar-short {
    --at-apply: w-34;
  }

  .comment-next-skeleton-fields {
    --at-apply: grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-0 box-border rounded-t-[var(--comment-next-radius-lg,0.875rem)] border-b border-b-solid [border-bottom-color:var(--comment-next-border-subtle-color,#e0e6ee)] [background:var(--comment-next-account-fields-bg,linear-gradient(180deg,rgb(252_253_253_/_0.98),rgb(249_251_251_/_0.98)))] px-3.5 py-2.5;
  }

  .comment-next-skeleton-fields-logged-in {
    --at-apply: grid-cols-[auto_minmax(0,1fr)];
  }

  .comment-next-skeleton-account-avatar {
    --at-apply: mr-3 h-[2.125rem] w-[2.125rem] rounded-full;
  }

  .comment-next-skeleton-current-user {
    --at-apply: flex min-w-0 items-center gap-2;
  }

  .comment-next-skeleton-field {
    --at-apply: relative flex h-9 box-border items-center gap-2.5 bg-transparent px-3.5 py-0;
  }

  .comment-next-skeleton-field + .comment-next-skeleton-field::before {
    --at-apply: absolute top-[0.45rem] bottom-[0.45rem] left-0 w-px bg-[var(--comment-next-field-divider-color,#dbe4ed)];
    content: "";
  }

  .comment-next-skeleton-field-icon {
    --at-apply: h-4 w-4 rounded-md;
  }

  .comment-next-skeleton-field-line {
    --at-apply: h-3 rounded-full;
  }

  .comment-next-skeleton-footer {
    --at-apply: min-h-[3.625rem] justify-between gap-3.5 border-t border-t-solid [border-top-color:var(--comment-next-border-subtle-color,#e2e8ef)] bg-[var(--comment-next-footer-bg-color,#fbfcfc)] px-3.5 py-0;
  }

  .comment-next-skeleton-tools,
  .comment-next-skeleton-actions {
    --at-apply: gap-2;
  }

  .comment-next-skeleton-ai-action {
    --at-apply: h-[2.125rem] w-[5.75rem] rounded-[0.5625rem];
  }

  .comment-next-skeleton-tool {
    --at-apply: h-7.5 w-7.5 rounded-lg;
  }

  .comment-next-skeleton-chip {
    --at-apply: h-[1.625rem] w-12 rounded-full;
  }

  .comment-next-skeleton-submit {
    --at-apply: h-9 w-[5.75rem] rounded-lg;
  }

  @keyframes comment-next-skeleton-shimmer {
    to {
      transform: translateX(100%);
    }
  }

  @media (max-width: 780px) {
    .comment-next-skeleton-footer {
      --at-apply: flex-col items-stretch p-3.5;
    }

    .comment-next-skeleton-actions {
      --at-apply: flex-wrap justify-between;
    }
  }

  @media (max-width: 720px) {
    .comment-next-skeleton-fields {
      --at-apply: grid-cols-[auto_minmax(0,1fr)] gap-0.5 p-2.5;
    }

    .comment-next-skeleton-fields:not(.comment-next-skeleton-fields-logged-in) .comment-next-skeleton-account-avatar {
      --at-apply: row-span-3 self-start mt-1;
    }

    .comment-next-skeleton-fields:not(.comment-next-skeleton-fields-logged-in) .comment-next-skeleton-field {
      --at-apply: col-start-2;
    }

    .comment-next-skeleton-field + .comment-next-skeleton-field::before {
      --at-apply: top-[-0.0625rem] right-3 bottom-auto left-3 h-px w-auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-skeleton-bar::after,
    .comment-next-skeleton-dot::after,
    .comment-next-skeleton-field-icon::after,
    .comment-next-skeleton-field-line::after,
    .comment-next-skeleton-account-avatar::after,
    .comment-next-skeleton-ai-action::after,
    .comment-next-skeleton-tool::after,
    .comment-next-skeleton-chip::after,
    .comment-next-skeleton-submit::after {
      --at-apply: animate-none;
    }
  }
</style>
