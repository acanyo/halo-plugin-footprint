<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';
import type { CommentNextReactionConfig } from './services/config';
import {
  fetchReactionSummary,
  toggleReaction,
  type CommentNextReactionItem,
  type CommentNextReactionSummary,
} from './services/reactions';
import {
  resolveConfiguredReactionItems,
} from './utils/reactions';

const {
  baseUrl = '',
  group = '',
  kind = '',
  version = 'v1alpha1',
  name = '',
  loggedIn = false,
  config,
}: {
  baseUrl?: string;
  group?: string;
  kind?: string;
  version?: string;
  name?: string;
  loggedIn?: boolean;
  config?: CommentNextReactionConfig;
} = $props();

let summary = $state<CommentNextReactionSummary | undefined>();
let loading = $state(false);
let failed = $state(false);
let togglingReaction = $state('');
let previousKey = $state('');

const configuredItems = $derived(
  resolveConfiguredReactionItems(
    config?.subjectItems?.length ? config.subjectItems : config?.items
  )
);
const enabled = $derived(Boolean(config?.enabled && config.subjectEnabled !== false && group && kind && name));
const allowAnonymous = $derived(config?.allowAnonymous !== false);
const canReact = $derived(loggedIn || allowAnonymous);
const prompt = $derived(
  summary?.prompt || config?.subjectPrompt || '你认为这篇文章怎么样？'
);
const items = $derived(summary?.items?.length ? summary.items : configuredItems);
const targetKey = $derived(`${baseUrl}|${group}|${kind}|${version}|${name}`);

$effect(() => {
  if (!enabled || previousKey === targetKey) {
    return;
  }

  previousKey = targetKey;
  void loadSummary();
});

async function loadSummary() {
  loading = true;
  failed = false;

  try {
    summary = await fetchReactionSummary({
      baseUrl,
      targetType: 'SUBJECT',
      group,
      kind,
      version,
      name,
    });
  } catch (error) {
    failed = true;
    console.warn('Failed to load reactions', error);
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
    summary = await toggleReaction({
      baseUrl,
      targetType: 'SUBJECT',
      group,
      kind,
      version,
      name,
      reaction: item.name,
    });
  } catch (error) {
    summary = previousSummary;
    console.warn('Failed to toggle reaction', error);
  } finally {
    togglingReaction = '';
  }
}

function applyOptimisticReaction(reaction: string) {
  const sourceSummary =
    summary ??
    ({
      targetType: 'SUBJECT',
      targetKey,
      prompt,
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

</script>

{#if enabled}
  <section
    class="comment-next-reaction-bar"
    aria-label="文章表情回应"
    data-loading={loading}
  >
    <div class="comment-next-reaction-prompt">{prompt}</div>
    <div class="comment-next-reaction-items">
      {#each items as item (item.name)}
        <button
          class:comment-next-reaction-item-selected={item.selected}
          class:comment-next-reaction-item-toggling={togglingReaction === item.name}
          type="button"
          disabled={!canReact || Boolean(togglingReaction)}
          title={!canReact ? '请登录后回应' : item.label}
          aria-pressed={item.selected}
          aria-label={`${item.label}，${item.count} 个回应`}
          onclick={() => handleReaction(item)}
        >
          <span class="comment-next-reaction-count">{item.count}</span>
          <span class="comment-next-reaction-emoji" aria-hidden="true">
            {#if item.type === 'IMAGE'}
              <img src={item.value} alt="" loading="lazy" />
            {:else}
              {item.value}
            {/if}
          </span>
          <span class="comment-next-reaction-label">{item.label}</span>
        </button>
      {/each}
      {#if loading && !items.length}
        <span class="comment-next-reaction-loading">
          <CommentNextIcon name="loader" size={15} />
        </span>
      {/if}
    </div>
  </section>
{/if}

<style>
  .comment-next-reaction-bar {
    --at-apply: mx-auto flex w-full max-w-[34rem] flex-col items-center gap-2.5 px-2 pb-0 pt-1 text-center;
  }

  .comment-next-reaction-prompt {
    --at-apply: text-[0.9375rem] text-[var(--comment-next-text-color,#172033)] font-[780] leading-6;
  }

  .comment-next-reaction-items {
    --at-apply: flex max-w-full items-end justify-center gap-3 overflow-x-auto px-1 pb-1;
    scrollbar-width: none;
  }

  .comment-next-reaction-items::-webkit-scrollbar {
    display: none;
  }

  .comment-next-reaction-items button {
    --at-apply: relative inline-flex min-h-[3.1rem] min-w-[2.75rem] cursor-pointer flex-col items-center justify-end gap-0.5 border-0 rounded-lg bg-transparent px-1.5 pb-1 pt-2 font-inherit text-[var(--comment-next-muted-color,#6b7687)] transition-[color,transform,background-color] duration-160 ease-in-out;
  }

  .comment-next-reaction-items button:hover:not(:disabled),
  .comment-next-reaction-items .comment-next-reaction-item-selected {
    --at-apply: bg-[var(--comment-next-reaction-hover-bg-color,rgb(239_246_255_/_0.68))] text-[var(--comment-next-primary-color,rgb(59,130,246))];
  }

  .comment-next-reaction-items button:hover:not(:disabled) .comment-next-reaction-emoji,
  .comment-next-reaction-items .comment-next-reaction-item-selected .comment-next-reaction-emoji {
    --at-apply: -translate-y-1 scale-110;
  }

  .comment-next-reaction-items button:active:not(:disabled) {
    --at-apply: translate-y-px;
  }

  .comment-next-reaction-items button:disabled {
    --at-apply: cursor-not-allowed opacity-60;
  }

  .comment-next-reaction-count {
    --at-apply: absolute left-[calc(50%+0.35rem)] top-0 min-w-[1.05rem] rounded-full bg-[var(--comment-next-primary-color,rgb(59,130,246))] px-1 text-[0.625rem] text-white font-[760] leading-[1.05rem] shadow-sm;
  }

  .comment-next-reaction-emoji {
    --at-apply: flex h-8 w-8 items-center justify-center text-[1.85rem] leading-none transition-[transform] duration-160 ease-in-out;
  }

  .comment-next-reaction-emoji img {
    --at-apply: h-8 w-8 rounded-md object-contain;
  }

  .comment-next-reaction-label {
    --at-apply: text-[0.68rem] font-[650] leading-4;
  }

  .comment-next-reaction-loading {
    --at-apply: inline-flex h-10 items-center justify-center text-[var(--comment-next-muted-color,#6b7687)] animate-spin;
  }

  @media (max-width: 640px) {
    .comment-next-reaction-bar {
      --at-apply: max-w-full items-start px-0 text-left;
    }

    .comment-next-reaction-items {
      --at-apply: justify-start gap-2.5;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-reaction-items button,
    .comment-next-reaction-emoji {
      --at-apply: transition-none;
    }

    .comment-next-reaction-loading {
      --at-apply: animate-none;
    }
  }
</style>
