<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';
import type { CommentNextReactionConfig } from './services/config';
import {
  fetchReactionSummary,
  toggleReaction,
  type CommentNextReactionItem,
  type CommentNextReactionSummary,
  type CommentNextReactionTargetType,
} from './services/reactions';
import {
  getReactionTotalCount,
  getVisibleReactionSummaryItems,
  resolveConfiguredReactionItems,
} from './utils/reactions';

const {
  baseUrl = '',
  targetType,
  name,
  loggedIn = false,
  config,
  demoData = false,
}: {
  baseUrl?: string;
  targetType: Exclude<CommentNextReactionTargetType, 'SUBJECT'>;
  name: string;
  loggedIn?: boolean;
  config?: CommentNextReactionConfig;
  demoData?: boolean;
} = $props();

let summary = $state<CommentNextReactionSummary | undefined>();
let rootElement = $state<HTMLElement | undefined>();
let open = $state(false);
let loading = $state(false);
let togglingReaction = $state('');
let previousKey = $state('');

const configuredItems = $derived(
  resolveConfiguredReactionItems(
    config?.commentItems?.length ? config.commentItems : config?.items
  )
);
const targetEnabled = $derived(
  targetType === 'COMMENT'
    ? config?.commentEnabled !== false
    : config?.replyEnabled !== false
);
const enabled = $derived(Boolean(config?.enabled && targetEnabled && name));
const allowAnonymous = $derived(config?.allowAnonymous !== false);
const canReact = $derived(loggedIn || allowAnonymous);
const items = $derived(summary?.items?.length ? summary.items : configuredItems);
const selectedItem = $derived(items.find((item) => item.selected));
const totalCount = $derived(getReactionTotalCount(items));
const visibleSummaryItems = $derived(getVisibleReactionSummaryItems(items));
const hiddenSummaryCount = $derived(
  Math.max(0, items.filter((item) => item.count > 0).length - visibleSummaryItems.length)
);
const targetKey = $derived(`${baseUrl}|${targetType}|${name}`);

$effect(() => {
  if (!enabled || demoData || previousKey === targetKey) {
    return;
  }

  previousKey = targetKey;
  void loadSummary();
});

$effect(() => {
  if (!open || typeof window === 'undefined') {
    return;
  }

  const handlePointerDown = (event: PointerEvent) => {
    const eventPath = event.composedPath();
    if (rootElement && !eventPath.includes(rootElement)) {
      open = false;
    }
  };

  window.addEventListener('pointerdown', handlePointerDown, true);
  return () => window.removeEventListener('pointerdown', handlePointerDown, true);
});

async function loadSummary() {
  loading = true;

  try {
    summary = await fetchReactionSummary({
      baseUrl,
      targetType,
      name,
    });
  } catch (error) {
    console.warn('Failed to load target reactions', error);
  } finally {
    loading = false;
  }
}

async function handleReaction(item: CommentNextReactionItem) {
  if (!canReact || togglingReaction) {
    return;
  }

  const previousSummary = summary;
  togglingReaction = item.name;
  applyOptimisticReaction(item.name);

  try {
    if (!demoData) {
      summary = await toggleReaction({
        baseUrl,
        targetType,
        name,
        reaction: item.name,
      });
    }
    open = false;
  } catch (error) {
    summary = previousSummary;
    console.warn('Failed to toggle target reaction', error);
  } finally {
    togglingReaction = '';
  }
}

function togglePopover() {
  if (!canReact) {
    return;
  }
  open = !open;
}

function applyOptimisticReaction(reaction: string) {
  const sourceSummary =
    summary ??
    ({
      targetType,
      targetKey,
      prompt: '',
      enabled: true,
      allowAnonymous,
      items,
    } satisfies CommentNextReactionSummary);
  const selectedReaction = sourceSummary.items.find((item) => item.selected)?.name;

  summary = {
    ...sourceSummary,
    items: sourceSummary.items.map((item) => {
      const selected = selectedReaction === reaction ? false : item.name === reaction;
      const selectedDelta =
        item.name === reaction && selectedReaction !== reaction
          ? 1
          : item.name === selectedReaction
            ? -1
            : 0;
      return {
        ...item,
        selected,
        count: Math.max(0, item.count + selectedDelta),
      };
    }),
  };
}

function reactionLabel(item: CommentNextReactionItem) {
  return item.count > 0 ? `${item.label} ${item.count}` : item.label;
}
</script>

{#if enabled}
  <span bind:this={rootElement} class="comment-next-target-reaction" class:comment-next-target-reaction-open={open}>
    <button
      class="comment-next-target-reaction-button"
      class:comment-next-target-reaction-button-selected={Boolean(selectedItem)}
      type="button"
      disabled={!canReact || loading}
      aria-label={totalCount > 0 ? `查看或更改表情回应，共 ${totalCount} 个` : '表情回应'}
      aria-expanded={open}
      aria-haspopup="menu"
      title={!canReact ? '请登录后回应' : selectedItem ? `已回应 ${selectedItem.label}` : '表情回应'}
      onclick={togglePopover}
    >
      {#if totalCount > 0}
        <span class="comment-next-target-reaction-summary-icons" aria-hidden="true">
          {#each visibleSummaryItems as item (item.name)}
            <span class="comment-next-target-reaction-summary-icon" title={reactionLabel(item)}>
              {#if item.type === 'IMAGE'}
                <img src={item.value} alt="" loading="lazy" />
              {:else}
                {item.value}
              {/if}
            </span>
          {/each}
          {#if hiddenSummaryCount > 0}
            <span class="comment-next-target-reaction-summary-more">+{hiddenSummaryCount}</span>
          {/if}
        </span>
        <span class="comment-next-target-reaction-count">{totalCount}</span>
      {:else}
        <span class="comment-next-target-reaction-empty-icon" aria-hidden="true">
          <CommentNextIcon name="smile" size={14} />
        </span>
      {/if}
    </button>

    {#if open}
      <span class="comment-next-target-reaction-popover" role="menu" aria-label="选择表情回应">
        {#each items as item (item.name)}
          <button
            class:comment-next-target-reaction-option-selected={item.selected}
            type="button"
            role="menuitemradio"
            aria-checked={item.selected}
            title={item.label}
            disabled={Boolean(togglingReaction)}
            onclick={() => handleReaction(item)}
          >
            <span class="comment-next-target-reaction-option-icon" aria-hidden="true">
              {#if item.type === 'IMAGE'}
                <img src={item.value} alt="" loading="lazy" />
              {:else}
                {item.value}
              {/if}
            </span>
            {#if item.count > 0}
              <span class="comment-next-target-reaction-option-count">{item.count}</span>
            {/if}
          </button>
        {/each}
      </span>
    {/if}
  </span>
{/if}

<style>
  .comment-next-target-reaction {
    --at-apply: relative inline-flex items-center align-middle;
  }

  .comment-next-target-reaction > button {
    --at-apply: inline-flex box-border cursor-pointer items-center justify-center border-0 bg-transparent p-0 font-inherit transition-[background-color,color,opacity,transform] duration-140 ease-in-out;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .comment-next-target-reaction-button {
    --at-apply: h-6 min-w-6 gap-1 rounded-full px-1.5 text-[0.8125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[720];
  }

  .comment-next-target-reaction-summary-icons {
    --at-apply: inline-flex items-center gap-0.5;
  }

  .comment-next-target-reaction-summary-icon {
    --at-apply: flex h-[1.05rem] w-[1.05rem] items-center justify-center text-[0.95rem] leading-none;
  }

  .comment-next-target-reaction-summary-icon img {
    --at-apply: h-[1.05rem] w-[1.05rem] rounded object-contain;
  }

  .comment-next-target-reaction-summary-more {
    --at-apply: inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] px-0.5 text-[0.58rem] text-[var(--comment-next-muted-color,#6b7687)] font-[780] leading-none;
  }

  .comment-next-target-reaction-count {
    --at-apply: text-[0.8125rem] text-[var(--comment-next-muted-color,#9aa3af)] font-[760] leading-none;
  }

  .comment-next-target-reaction-empty-icon {
    --at-apply: flex h-[1.05rem] w-[1.05rem] items-center justify-center text-[0.98rem] leading-none;
  }

  .comment-next-target-reaction > button:hover,
  .comment-next-target-reaction > button:focus-visible,
  .comment-next-target-reaction-open > .comment-next-target-reaction-button {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-target-reaction-button-selected {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-target-reaction-button-selected .comment-next-target-reaction-count {
    --at-apply: text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-target-reaction > button:focus {
    outline: none;
  }

  .comment-next-target-reaction > button:disabled {
    --at-apply: cursor-not-allowed opacity-60;
  }

  .comment-next-target-reaction-popover {
    --at-apply: absolute left-0 top-[calc(100%+0.4rem)] z-20 inline-flex max-w-[min(16rem,calc(100vw-2rem))] items-center gap-1 rounded-full border border-solid [border-color:var(--comment-next-border-subtle-color,#dfe5ec)] bg-[var(--comment-next-toolbar-bg-color,#ffffff)] px-1.5 py-1 shadow-[0_10px_26px_rgb(15_23_42_/_0.13)];
  }

  .comment-next-target-reaction-popover button {
    --at-apply: relative inline-flex h-7 w-7 cursor-pointer items-center justify-center border-0 rounded-full bg-transparent p-0 font-inherit transition-[background-color,box-shadow,transform] duration-140 ease-in-out;
  }

  .comment-next-target-reaction-popover button:hover,
  .comment-next-target-reaction-popover .comment-next-target-reaction-option-selected {
    --at-apply: bg-[var(--comment-next-reaction-hover-bg-color,rgb(239_246_255_/_0.88))] shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.16)] -translate-y-0.5;
  }

  .comment-next-target-reaction-popover button:disabled {
    --at-apply: cursor-wait opacity-70;
  }

  .comment-next-target-reaction-option-icon {
    --at-apply: flex h-5 w-5 items-center justify-center text-[1rem] leading-none;
  }

  .comment-next-target-reaction-option-icon img {
    --at-apply: h-5 w-5 rounded object-contain;
  }

  .comment-next-target-reaction-option-count {
    --at-apply: absolute -right-0.5 -top-0.5 min-w-[0.95rem] rounded-full bg-[var(--comment-next-primary-color,rgb(59,130,246))] px-0.5 text-[0.58rem] text-white font-[760] leading-[0.95rem];
  }

  @media (max-width: 520px) {
    .comment-next-target-reaction-popover {
      --at-apply: left-auto right-0;
    }
  }
</style>
