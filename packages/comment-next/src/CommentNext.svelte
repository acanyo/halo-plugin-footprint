<svelte:options
  customElement={{
    tag: "comment-next",
    props: {
      baseUrl: { reflect: true, type: "String", attribute: "base-url" },
      group: { reflect: true, type: "String", attribute: "group" },
      kind: { reflect: true, type: "String", attribute: "kind" },
      version: { reflect: true, type: "String", attribute: "version" },
      name: { reflect: true, type: "String", attribute: "name" },
      loggedIn: { reflect: true, type: "Boolean", attribute: "logged-in" },
      allowAnonymous: { reflect: true, type: "Boolean", attribute: "allow-anonymous" },
      showCaptcha: { reflect: true, type: "Boolean", attribute: "show-captcha" },
      enablePrivate: { reflect: true, type: "Boolean", attribute: "enable-private" },
      loading: { reflect: true, type: "Boolean", attribute: "loading" },
      submitting: { reflect: true, type: "Boolean", attribute: "submitting" },
      commandMenuOpen: { reflect: true, type: "Boolean", attribute: "command-menu-open" },
      inlineSuggestion: { reflect: true, type: "Boolean", attribute: "inline-suggestion" },
      selectionTools: { reflect: true, type: "Boolean", attribute: "selection-tools" },
      placeholder: { reflect: true, type: "String", attribute: "placeholder" },
      autoFocus: { reflect: true, type: "Boolean", attribute: "auto-focus" },
      editorOnly: { reflect: true, type: "Boolean", attribute: "editor-only" },
      allowImages: { reflect: true, type: "Boolean", attribute: "allow-images" },
      showAccountFields: { reflect: true, type: "Boolean", attribute: "show-account-fields" },
      showFooter: { reflect: true, type: "Boolean", attribute: "show-footer" },
      showSubmitArea: { reflect: true, type: "Boolean", attribute: "show-submit-area" },
      showComments: { reflect: true, type: "Boolean", attribute: "show-comments" },
      demoData: { reflect: true, type: "Boolean", attribute: "demo-data" },
      pageSize: { reflect: true, type: "Number", attribute: "page-size" },
      replySize: { reflect: true, type: "Number", attribute: "reply-size" },
      withReplies: { reflect: true, type: "Boolean", attribute: "with-replies" },
    },
  }}
/>

<script lang="ts">
import { onMount } from 'svelte';
import CommentNextRoot from './CommentNextRoot.svelte';
import { sanitizeCommentSubmitHtml, sanitizeConsoleCommentHtml } from './utils/html';

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
  autoFocus = false,
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
  autoFocus?: boolean;
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
} = $props();

type CommentNextRootRef = {
  focus: () => void;
  reset: () => void;
};

let rootRef: CommentNextRootRef | undefined;

onMount(() => {
  if (autoFocus) {
    window.setTimeout(() => rootRef?.focus(), 80);
  }
});

export function setFocus() {
  rootRef?.focus();
}

export function reset() {
  rootRef?.reset();
  emitUpdate('');
}

function handleEditorChange(html: string) {
  emitUpdate(html);
}

function emitUpdate(html: string) {
  if (!editorOnly) {
    return;
  }

  const content = allowImages
    ? sanitizeCommentSubmitHtml(html)
    : sanitizeConsoleCommentHtml(html);

  $host().dispatchEvent(
    new CustomEvent('update', {
      detail: {
        content,
        characterCount: getContentLength(content),
      },
      bubbles: true,
      composed: true,
    })
  );
}

function getContentLength(html: string): number {
  if (!html.trim() || typeof document === 'undefined') {
    return 0;
  }

  const template = document.createElement('template');
  template.innerHTML = allowImages
    ? sanitizeCommentSubmitHtml(html)
    : sanitizeConsoleCommentHtml(html);

  return (
    (template.content.textContent?.trim().length ?? 0) +
    template.content.querySelectorAll('img[src], halo-lottie[src]').length
  );
}
</script>

<CommentNextRoot
  bind:this={rootRef}
  {baseUrl}
  {group}
  {kind}
  {version}
  {name}
  {loggedIn}
  {allowAnonymous}
  {showCaptcha}
  {enablePrivate}
  {loading}
  {submitting}
  {commandMenuOpen}
  {inlineSuggestion}
  {selectionTools}
  {placeholder}
  {editorOnly}
  {allowImages}
  {showAccountFields}
  {showFooter}
  {showSubmitArea}
  {showComments}
  {demoData}
  {pageSize}
  {replySize}
  {withReplies}
  onEditorChange={handleEditorChange}
/>

<style>
  :host {
    --at-apply: block w-full;
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
  }
</style>
