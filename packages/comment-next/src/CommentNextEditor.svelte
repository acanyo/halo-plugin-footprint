<script lang="ts">
import { onMount, tick } from 'svelte';
import CommentNextAiSuggestion from './CommentNextAiSuggestion.svelte';
import CommentNextIcon from './CommentNextIcon.svelte';
import type { CommentNextEditorImageKind } from './types/editor';
import type { CommentNextEmoteItem } from './types/emote';
import {
  autolinkUrls,
  getTextSelectionOffset,
  restoreTextSelectionOffset,
} from './utils/autolink';
import { isImageFile } from './utils/image-files';

type PendingCommandTrigger = {
  startOffset: number;
  endOffset: number;
};

type PendingMentionTrigger = PendingCommandTrigger & {
  query: string;
};

type ResizableMedia = HTMLElement;
type ResizeState = {
  media: ResizableMedia;
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  ratio: number;
  changed: boolean;
};

const COMMAND_TRIGGER_PATTERN = /(?:^|\s)(\/[^\s/@]*)$/;
const MENTION_TRIGGER_PATTERN = /(?:^|\s)(@([^\s@/]*)?)$/;
const RESIZABLE_MEDIA_SELECTOR = [
  'halo-lottie.comment-next-editor-lottie',
  'img.comment-next-editor-emote-image',
  'img.comment-next-editor-image',
].join(', ');
const LIMITED_MEDIA_SELECTOR = [
  'halo-lottie.comment-next-editor-lottie',
  'img.comment-next-editor-emote-image',
].join(', ');
const MIN_MEDIA_SIZE = 24;
const MAX_MEDIA_SIZE = 4096;

const {
  placeholder = '写下你的评论...',
  aiOpen = false,
  inlineSuggestion = false,
  selectionTools = false,
  aiMode = 'polish',
  suggestionText = '',
  suggestionLoading = false,
  aiAssistantName = '评论助手',
  aiAssistantMentionName = '',
  aiMentionEnabled = true,
  allowImages = true,
  topRounded = false,
  onChange = () => {},
  onImagePaste = () => {},
  onCommandMenuRequest = () => {},
  onCloseAiPanel = () => {},
  onAcceptSuggestion = () => {},
  onInsertSuggestion = () => {},
  onRewriteSuggestion = () => {},
  onRejectSuggestion = () => {},
}: {
  placeholder?: string;
  aiOpen?: boolean;
  inlineSuggestion?: boolean;
  selectionTools?: boolean;
  aiMode?: string;
  suggestionText?: string;
  suggestionLoading?: boolean;
  aiAssistantName?: string;
  aiAssistantMentionName?: string;
  aiMentionEnabled?: boolean;
  allowImages?: boolean;
  topRounded?: boolean;
  onChange?: (html: string) => void;
  onImagePaste?: (files: File[]) => Promise<void> | void;
  onCommandMenuRequest?: () => void;
  onCloseAiPanel?: () => void;
  onAcceptSuggestion?: () => void;
  onInsertSuggestion?: () => void;
  onRewriteSuggestion?: () => void;
  onRejectSuggestion?: () => void;
} = $props();

let editorWrapElement: HTMLDivElement | undefined;
let editorElement: HTMLDivElement | undefined;
let autolinkTimer: number | undefined;
let pendingCommandTrigger = $state<PendingCommandTrigger | undefined>();
let pendingMentionTrigger = $state<PendingMentionTrigger | undefined>();
let mentionPanelStyle = $state('');
let selectedMedia = $state<ResizableMedia | undefined>();
let resizeHandleStyle = $state('');
let resizeHandleElement = $state<HTMLButtonElement | undefined>();
let resizeState: ResizeState | undefined;

const resolvedMentionName = $derived(
  normalizeMentionName(aiAssistantMentionName || aiAssistantName)
);
const mentionSuggestionVisible = $derived(
  Boolean(
    aiMentionEnabled &&
      pendingMentionTrigger &&
      assistantMentionMatchesQuery(pendingMentionTrigger.query)
  )
);

onMount(() => {
  window.addEventListener('resize', updateResizeHandlePosition);
  window.addEventListener('scroll', updateResizeHandlePosition, true);
  window.addEventListener('pointermove', handleResizePointerMove, true);
  window.addEventListener('pointerup', handleResizePointerUp, true);
  window.addEventListener('pointercancel', handleResizePointerUp, true);

  return () => {
    window.removeEventListener('resize', updateResizeHandlePosition);
    window.removeEventListener('scroll', updateResizeHandlePosition, true);
    window.removeEventListener('pointermove', handleResizePointerMove, true);
    window.removeEventListener('pointerup', handleResizePointerUp, true);
    window.removeEventListener('pointercancel', handleResizePointerUp, true);
    if (autolinkTimer) {
      window.clearTimeout(autolinkTimer);
    }
    resizeState = undefined;
  };
});

export function getHtml(): string {
  return getSerializableEditorHtml();
}

export function getText(): string {
  return getSerializableEditorText();
}

export function getLimitedMediaDimensions(): Array<{
  type: 'emote' | 'lottie';
  width: number;
  height: number;
}> {
  if (!editorElement) {
    return [];
  }

  return Array.from(
    editorElement.querySelectorAll<ResizableMedia>(LIMITED_MEDIA_SELECTOR)
  ).map((media) => {
    const bounds = media.getBoundingClientRect();
    const fallbackWidth = Math.max(MIN_MEDIA_SIZE, Math.round(bounds.width));
    const fallbackHeight = Math.max(MIN_MEDIA_SIZE, Math.round(bounds.height));
    return {
      type: media.matches('halo-lottie') ? 'lottie' : 'emote',
      width: getMediaDimension(media, 'width', fallbackWidth),
      height: getMediaDimension(media, 'height', fallbackHeight),
    };
  });
}

export function reset() {
  if (!editorElement) {
    return;
  }

  editorElement.innerHTML = '';
  clearSelectedMedia();
  onChange('');
}

export function focus() {
  editorElement?.focus();
}

export function insertText(value: string) {
  if (!value || !editorElement) {
    return;
  }

  insertNodeAtCaret(document.createTextNode(value));
}

export function replaceText(value: string) {
  if (!editorElement) {
    return;
  }

  editorElement.textContent = value;
  onChange(getHtml());
  editorElement.focus();
}

export function insertImage(
  src: string,
  alt = '',
  kind: CommentNextEditorImageKind = 'image'
) {
  if (!allowImages || !src || !editorElement) {
    return;
  }

  const image = document.createElement('img');
  image.src = src;
  image.alt = alt;
  image.className =
    kind === 'emote'
      ? 'comment-next-editor-emote-image'
      : 'comment-next-editor-image';
  image.loading = 'lazy';
  image.decoding = 'async';
  insertNodeAtCaret(image, document.createTextNode(' '));
}

export function insertLottie(item: CommentNextEmoteItem) {
  if (!item.contentUrl || !editorElement) {
    return;
  }

  const defaults = item.defaults;
  const width = Number(defaults?.width) > 0 ? Number(defaults?.width) : 160;
  const height = Number(defaults?.height) > 0 ? Number(defaults?.height) : 160;
  const element = document.createElement('halo-lottie');
  element.className = 'comment-next-editor-lottie';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('src', item.contentUrl);
  element.setAttribute('format', item.format || 'json');
  element.setAttribute('width', String(Math.max(1, Math.round(width))));
  element.setAttribute('height', String(Math.max(1, Math.round(height))));
  element.setAttribute('autoplay', 'true');
  element.setAttribute('loop', defaults?.loop === false ? 'false' : 'true');
  element.setAttribute('speed', String(Number(defaults?.speed) > 0 ? defaults?.speed : 1));
  element.setAttribute('fit', defaults?.fit || 'contain');
  element.setAttribute('align', defaults?.align || 'center');
  element.setAttribute('controls', defaults?.controls ? 'true' : 'false');
  element.setAttribute('hover-play', 'false');
  element.setAttribute('freeze-on-offscreen', 'true');
  element.setAttribute('aria-label', defaults?.ariaLabel || item.label);
  insertNodeAtCaret(element, document.createTextNode(' '));
}

export function replaceImageSrc(
  sourceSrc: string,
  targetSrc: string,
  alt?: string
) {
  if (!allowImages || !sourceSrc || !targetSrc || !editorElement) {
    return;
  }

  let replaced = false;

  for (const image of Array.from(editorElement.querySelectorAll('img'))) {
    if (image.getAttribute('src') !== sourceSrc) {
      continue;
    }

    image.src = targetSrc;
    image.setAttribute('src', targetSrc);
    if (alt) {
      image.alt = alt;
    }
    replaced = true;
  }

  if (replaced) {
    onChange(getHtml());
  }
}

export function insertHtml(value: string) {
  if (!value || !editorElement) {
    return;
  }

  editorElement.focus();
  document.execCommand('insertHTML', false, value);
  if (!allowImages) {
    removeEditorImages();
  }
  onChange(getHtml());
}

export function runCommand(command: string, value?: string) {
  if (!command || !editorElement) {
    return;
  }

  editorElement.focus();
  document.execCommand(command, false, value);
  if (!allowImages) {
    removeEditorImages();
  }
  onChange(getHtml());
}

export function consumeCommandTrigger() {
  consumePendingCommandTrigger();
}

function handleEditorInput() {
  if (!allowImages) {
    removeEditorImages();
  }

  onChange(getHtml());

  if (inlineSuggestion || selectionTools) {
    return;
  }

  updateCommandTrigger();
  updateMentionTrigger();
  scheduleAutolink();
}

function handleEditorPointerDown(event: PointerEvent) {
  const target = event.target;
  const media =
    target instanceof Element
      ? target.closest<ResizableMedia>(RESIZABLE_MEDIA_SELECTOR)
      : null;

  if (media && editorElement?.contains(media)) {
    event.preventDefault();
    selectMedia(media);
    return;
  }

  clearSelectedMedia();
}

function selectMedia(media: ResizableMedia) {
  selectedMedia = media;
  updateResizeHandlePosition();
}

function clearSelectedMedia() {
  resizeState = undefined;
  selectedMedia = undefined;
  resizeHandleStyle = '';
}

function updateResizeHandlePosition() {
  if (!selectedMedia || !editorWrapElement || !editorElement?.contains(selectedMedia)) {
    if (selectedMedia) {
      clearSelectedMedia();
    }
    return;
  }

  const mediaRect = selectedMedia.getBoundingClientRect();
  const wrapRect = editorWrapElement.getBoundingClientRect();
  if (mediaRect.width <= 0 || mediaRect.height <= 0) {
    resizeHandleStyle = '';
    return;
  }

  resizeHandleStyle = [
    `left:${Math.round(mediaRect.right - wrapRect.left - 7)}px`,
    `top:${Math.round(mediaRect.bottom - wrapRect.top - 7)}px`,
  ].join(';');
}

function handleResizePointerDown(event: PointerEvent) {
  if (!selectedMedia) {
    return;
  }

  const rect = selectedMedia.getBoundingClientRect();
  const startWidth = getMediaDimension(selectedMedia, 'width', rect.width);
  const startHeight = getMediaDimension(selectedMedia, 'height', rect.height);
  if (startWidth <= 0 || startHeight <= 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  resizeState = {
    media: selectedMedia,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth,
    startHeight,
    ratio: startWidth / Math.max(1, startHeight),
    changed: false,
  };
  resizeHandleElement?.setPointerCapture?.(event.pointerId);
}

function handleResizePointerMove(event: PointerEvent) {
  const state = resizeState;
  if (!state || event.pointerId !== state.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const deltaX = event.clientX - state.startX;
  const deltaY = (event.clientY - state.startY) * state.ratio;
  const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
  let width = clampMediaDimension(state.startWidth + delta);
  let height = clampMediaDimension(width / Math.max(0.01, state.ratio));

  // Keep both dimensions within the runtime's safe range while preserving
  // the original aspect ratio.
  if (height >= MAX_MEDIA_SIZE) {
    height = MAX_MEDIA_SIZE;
    width = clampMediaDimension(height * state.ratio);
  }

  if (
    Math.round(width) === Math.round(state.startWidth) &&
    Math.round(height) === Math.round(state.startHeight)
  ) {
    return;
  }

  setMediaDimensions(state.media, width, height);
  state.changed = true;
  updateResizeHandlePosition();
}

function handleResizePointerUp(event: PointerEvent) {
  const state = resizeState;
  if (!state || event.pointerId !== state.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  resizeState = undefined;
  if (resizeHandleElement?.hasPointerCapture?.(event.pointerId)) {
    resizeHandleElement.releasePointerCapture(event.pointerId);
  }
  if (state.changed) {
    onChange(getHtml());
  }
}

function getMediaDimension(
  media: ResizableMedia,
  name: 'width' | 'height',
  fallback: number
): number {
  const attributeValue = Number(media.getAttribute(name));
  return Number.isFinite(attributeValue) && attributeValue > 0
    ? attributeValue
    : fallback;
}

function setMediaDimensions(media: ResizableMedia, width: number, height: number) {
  media.setAttribute('width', String(Math.round(width)));
  media.setAttribute('height', String(Math.round(height)));
}

function clampMediaDimension(value: number): number {
  return Math.min(MAX_MEDIA_SIZE, Math.max(MIN_MEDIA_SIZE, Math.round(value)));
}

function handleEditorKeyDown(event: KeyboardEvent) {
  if (
    mentionSuggestionVisible &&
    (event.key === 'Enter' || event.key === 'Tab')
  ) {
    event.preventDefault();
    insertAssistantMention();
    return;
  }

  if (event.key === 'Escape' && mentionSuggestionVisible) {
    event.preventDefault();
    closeMentionPanel();
    return;
  }

  if (event.key !== 'Escape' || !aiOpen || inlineSuggestion || selectionTools) {
    return;
  }

  pendingCommandTrigger = undefined;
  onCloseAiPanel();
}

function handleEditorPaste(event: ClipboardEvent) {
  const imageFiles = getClipboardImageFiles(event.clipboardData);
  if (imageFiles.length) {
    event.preventDefault();
    if (!allowImages) {
      return;
    }
    void onImagePaste(imageFiles);
    return;
  }

  if (inlineSuggestion || selectionTools) {
    return;
  }

  window.setTimeout(() => {
    if (allowImages) {
      normalizeEditorImages();
    } else {
      removeEditorImages();
      onChange(getHtml());
    }
    runAutolink();
  }, 0);
}

function handleEditorBlur() {
  window.setTimeout(() => {
    if (
      editorWrapElement?.contains(document.activeElement) ||
      editorElement === document.activeElement
    ) {
      return;
    }

    closeMentionPanel();
  }, 0);
}

function updateCommandTrigger() {
  const trigger = getActiveCommandTrigger();

  if (trigger) {
    closeMentionPanel();
    pendingCommandTrigger = trigger;
    onCommandMenuRequest();
    return;
  }

  if (pendingCommandTrigger) {
    pendingCommandTrigger = undefined;

    if (aiOpen) {
      onCloseAiPanel();
    }
  }
}

function updateMentionTrigger() {
  if (!aiMentionEnabled) {
    closeMentionPanel();
    return;
  }

  const trigger = getActiveMentionTrigger();

  if (trigger && assistantMentionMatchesQuery(trigger.query)) {
    pendingMentionTrigger = trigger;

    if (aiOpen) {
      onCloseAiPanel();
    }

    void updateMentionPanelPosition(trigger);
    return;
  }

  closeMentionPanel();
}

function getActiveCommandTrigger(): PendingCommandTrigger | undefined {
  if (!editorElement) {
    return undefined;
  }

  const endOffset = getTextSelectionOffset(editorElement);

  if (endOffset === undefined) {
    return undefined;
  }

  const beforeCaret = getSerializableEditorText().slice(0, endOffset);
  const match = beforeCaret.match(COMMAND_TRIGGER_PATTERN);

  if (!match) {
    return undefined;
  }

  const matchedText = match[0];
  const markerOffset = matchedText.lastIndexOf('/');
  const startOffset = beforeCaret.length - matchedText.length + markerOffset;

  return {
    startOffset,
    endOffset,
  };
}

function getActiveMentionTrigger(): PendingMentionTrigger | undefined {
  if (!editorElement) {
    return undefined;
  }

  const endOffset = getTextSelectionOffset(editorElement);

  if (endOffset === undefined) {
    return undefined;
  }

  const beforeCaret = getSerializableEditorText().slice(0, endOffset);
  const match = beforeCaret.match(MENTION_TRIGGER_PATTERN);

  if (!match) {
    return undefined;
  }

  const matchedText = match[0];
  const markerOffset = matchedText.lastIndexOf('@');
  const startOffset = beforeCaret.length - matchedText.length + markerOffset;

  return {
    startOffset,
    endOffset,
    query: match[2] ?? '',
  };
}

function consumePendingCommandTrigger() {
  if (!editorElement) {
    pendingCommandTrigger = undefined;
    return;
  }

  const trigger = getActiveCommandTrigger() ?? pendingCommandTrigger;
  pendingCommandTrigger = undefined;

  if (!trigger || trigger.endOffset <= trigger.startOffset) {
    return;
  }

  const range = createTextOffsetRange(
    editorElement,
    trigger.startOffset,
    trigger.endOffset
  );

  if (!range) {
    return;
  }

  range.deleteContents();
  editorElement.normalize();
  restoreTextSelectionOffset(editorElement, trigger.startOffset);
  onChange(getHtml());
}

function insertAssistantMention() {
  if (!editorElement) {
    return;
  }

  const trigger = getActiveMentionTrigger() ?? pendingMentionTrigger;

  if (!trigger || !assistantMentionMatchesQuery(trigger.query)) {
    closeMentionPanel();
    return;
  }

  const mentionText = `${resolvedMentionName} `;

  if (trigger.endOffset <= trigger.startOffset) {
    closeMentionPanel();
    insertText(mentionText);
    return;
  }

  const fallbackText = replaceTextRange(
    getSerializableEditorText(),
    trigger.startOffset,
    trigger.endOffset,
    mentionText
  );
  const selectionOffset = trigger.startOffset + mentionText.length;
  const inserted = replaceEditorRangeWithText(trigger, mentionText);

  if (!inserted || !hasTextAtOffset(mentionText, trigger.startOffset)) {
    replaceEditorText(fallbackText, selectionOffset);
  }

  closeMentionPanel();
  onChange(getHtml());
}

function replaceEditorRangeWithText(
  trigger: PendingMentionTrigger,
  text: string
): boolean {
  if (!editorElement) {
    return false;
  }

  const editor = editorElement;
  const range = createTextOffsetRange(
    editor,
    trigger.startOffset,
    trigger.endOffset
  );

  if (!range) {
    return false;
  }

  editor.focus();
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  editor.normalize();
  restoreTextSelectionOffset(editor, trigger.startOffset + text.length);

  return true;
}

function replaceTextRange(
  value: string,
  startOffset: number,
  endOffset: number,
  replacement: string
): string {
  return `${value.slice(0, startOffset)}${replacement}${value.slice(endOffset)}`;
}

function hasTextAtOffset(text: string, offset: number): boolean {
  return (
    getSerializableEditorText().slice(offset, offset + text.length) === text
  );
}

function replaceEditorText(text: string, selectionOffset: number) {
  if (!editorElement) {
    return;
  }

  editorElement.textContent = text;
  editorElement.focus();
  restoreTextSelectionOffset(editorElement, selectionOffset);
}

function closeMentionPanel() {
  pendingMentionTrigger = undefined;
  mentionPanelStyle = '';
}

async function updateMentionPanelPosition(trigger: PendingMentionTrigger) {
  if (!editorElement || !editorWrapElement) {
    return;
  }

  await tick();

  if (!editorElement || !editorWrapElement || !pendingMentionTrigger) {
    return;
  }

  const range = createTextOffsetRange(
    editorElement,
    trigger.startOffset,
    trigger.endOffset
  );
  const wrapRect = editorWrapElement.getBoundingClientRect();
  const editorRect = editorElement.getBoundingClientRect();
  const triggerRect = range?.getBoundingClientRect();
  const rect =
    triggerRect && triggerRect.width + triggerRect.height > 0
      ? triggerRect
      : editorRect;
  const panelWidth = Math.min(288, Math.max(220, wrapRect.width - 24));
  const left = Math.min(
    Math.max(12, rect.left - wrapRect.left),
    Math.max(12, wrapRect.width - panelWidth - 12)
  );
  const top = Math.max(12, rect.bottom - wrapRect.top + 8);

  mentionPanelStyle = [
    `--comment-next-mention-left:${left}px`,
    `--comment-next-mention-top:${top}px`,
    `--comment-next-mention-width:${panelWidth}px`,
  ].join(';');
}

function normalizeMentionName(value: string): string {
  const normalizedValue = value.trim() || '评论助手';
  return normalizedValue.startsWith('@')
    ? normalizedValue
    : `@${normalizedValue}`;
}

function assistantMentionMatchesQuery(query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const displayName = aiAssistantName.trim().toLocaleLowerCase();
  const mentionName = resolvedMentionName
    .replace(/^@/, '')
    .trim()
    .toLocaleLowerCase();

  return (
    displayName.includes(normalizedQuery) ||
    mentionName.includes(normalizedQuery)
  );
}

function createTextOffsetRange(
  root: HTMLElement,
  startOffset: number,
  endOffset: number
): Range | undefined {
  const range = document.createRange();
  const start = Math.max(0, Math.min(startOffset, endOffset));
  const end = Math.max(start, endOffset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let currentNode = walker.nextNode();
  let startSet = false;

  while (currentNode) {
    const textLength = currentNode.textContent?.length ?? 0;
    const nextOffset = currentOffset + textLength;

    if (!startSet && start <= nextOffset) {
      range.setStart(currentNode, Math.max(0, start - currentOffset));
      startSet = true;
    }

    if (startSet && end <= nextOffset) {
      range.setEnd(currentNode, Math.max(0, end - currentOffset));
      return range;
    }

    currentOffset = nextOffset;
    currentNode = walker.nextNode();
  }

  if (!startSet) {
    return undefined;
  }

  range.setEnd(root, root.childNodes.length);

  return range;
}

function scheduleAutolink(delay = 260) {
  if (!editorElement) {
    return;
  }

  if (autolinkTimer) {
    window.clearTimeout(autolinkTimer);
  }

  autolinkTimer = window.setTimeout(() => {
    runAutolink();
  }, delay);
}

function runAutolink() {
  if (!editorElement) {
    return;
  }

  const wasFocused = document.activeElement === editorElement;
  const selectionOffset = wasFocused
    ? getTextSelectionOffset(editorElement)
    : undefined;
  const changed = autolinkUrls(editorElement);

  if (changed && wasFocused && selectionOffset !== undefined) {
    restoreTextSelectionOffset(editorElement, selectionOffset);
  }

  onChange(getHtml());
}

function getSerializableEditorHtml(): string {
  if (!editorElement) {
    return '';
  }

  const clone = editorElement.cloneNode(true) as HTMLElement;
  removeTransientEditorNodes(clone);

  return clone.innerHTML;
}

function getSerializableEditorText(): string {
  if (!editorElement) {
    return '';
  }

  const clone = editorElement.cloneNode(true) as HTMLElement;
  removeTransientEditorNodes(clone);

  return clone.textContent ?? '';
}

function removeTransientEditorNodes(root: HTMLElement) {
  root
    .querySelectorAll('[data-comment-next-transient="true"]')
    .forEach((node) => {
      node.remove();
    });
}

function getClipboardImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }

  const imageFiles = new Map<string, File>();

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file') {
      continue;
    }

    const file = item.getAsFile();
    if (file && isImageFile(file)) {
      imageFiles.set(fileKey(file), file);
    }
  }

  for (const file of Array.from(clipboardData.files)) {
    if (isImageFile(file)) {
      imageFiles.set(fileKey(file), file);
    }
  }

  return Array.from(imageFiles.values());
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function normalizeEditorImages() {
  if (!editorElement) {
    return;
  }

  for (const image of Array.from(editorElement.querySelectorAll('img'))) {
    if (!image.classList.contains('comment-next-editor-emote-image')) {
      image.classList.add('comment-next-editor-image');
    }
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt ||= '图片';
  }

  onChange(getHtml());
}

function removeEditorImages() {
  if (!editorElement) {
    return;
  }

  for (const image of Array.from(editorElement.querySelectorAll('img'))) {
    image.remove();
  }
}

function insertNodeAtCaret(node: Node, trailingNode?: Node) {
  if (!editorElement) {
    return;
  }

  editorElement.focus();

  const selection = window.getSelection();
  const range = resolveEditorRange(selection);

  range.deleteContents();
  range.insertNode(node);

  if (trailingNode) {
    range.setStartAfter(node);
    range.insertNode(trailingNode);
    range.setStartAfter(trailingNode);
  } else {
    range.setStartAfter(node);
  }

  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  onChange(getHtml());
}

function resolveEditorRange(selection: Selection | null): Range {
  if (
    selection?.rangeCount &&
    editorElement &&
    isSelectionInsideEditor(selection)
  ) {
    return selection.getRangeAt(0);
  }

  const range = document.createRange();
  range.selectNodeContents(editorElement as HTMLDivElement);
  range.collapse(false);

  return range;
}

function isSelectionInsideEditor(selection: Selection): boolean {
  if (!editorElement || !selection.anchorNode || !selection.focusNode) {
    return false;
  }

  if (
    isNodeInsideTransient(selection.anchorNode) ||
    isNodeInsideTransient(selection.focusNode)
  ) {
    return false;
  }

  return (
    editorElement === selection.anchorNode ||
    editorElement.contains(selection.anchorNode) ||
    editorElement === selection.focusNode ||
    editorElement.contains(selection.focusNode)
  );
}

function isNodeInsideTransient(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return Boolean(
      (node as Element).closest('[data-comment-next-transient="true"]')
    );
  }

  return Boolean(
    node.parentElement?.closest('[data-comment-next-transient="true"]')
  );
}
</script>

<div
  bind:this={editorWrapElement}
  class:comment-next-editor-wrap-inline={inlineSuggestion}
  class:comment-next-editor-wrap-selection={selectionTools}
  class:comment-next-editor-wrap-top-rounded={topRounded}
  class="comment-next-editor-wrap"
>
  <div
    bind:this={editorElement}
    class="comment-next-editor"
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    data-placeholder={placeholder}
    aria-label="评论内容"
    oninput={handleEditorInput}
    onpointerdown={handleEditorPointerDown}
    onkeydown={handleEditorKeyDown}
    onblur={handleEditorBlur}
    onpaste={handleEditorPaste}
  >
    {#if inlineSuggestion}
      <CommentNextAiSuggestion
        mode={aiMode}
        text={suggestionText}
        loading={suggestionLoading}
        {aiAssistantName}
        onAccept={onAcceptSuggestion}
        onInsert={onInsertSuggestion}
        onRewrite={onRewriteSuggestion}
        onReject={onRejectSuggestion}
      />
    {:else if selectionTools}
      <p class="comment-next-editor-paragraph">
        这篇文章给了我很多启发，尤其是关于
        <mark class="comment-next-selection-mark">长期主义的部分</mark>
        ，让我对产品设计有了新的思考。
      </p>
    {/if}
  </div>

  {#if selectedMedia && resizeHandleStyle}
    <button
      bind:this={resizeHandleElement}
      class="comment-next-editor-resize-handle"
      data-comment-next-transient="true"
      type="button"
      aria-label="调整媒体大小"
      title="拖拽调整大小"
      style={resizeHandleStyle}
      onpointerdown={handleResizePointerDown}
    ></button>
  {/if}

  {#if mentionSuggestionVisible}
    <div
      class="comment-next-mention-panel"
      data-comment-next-transient="true"
      role="listbox"
      aria-label="AI 助手候选"
      style={mentionPanelStyle}
    >
      <button
        class="comment-next-mention-option"
        type="button"
        role="option"
        aria-selected="true"
        onmousedown={(event) => {
          event.preventDefault();
          insertAssistantMention();
        }}
        onpointerdown={(event) => {
          event.preventDefault();
          insertAssistantMention();
        }}
        onclick={(event) => {
          event.preventDefault();
          insertAssistantMention();
        }}
      >
        <span class="comment-next-mention-option-icon" aria-hidden="true">
          <CommentNextIcon name="sparkle" size={15} />
        </span>
        <span class="comment-next-mention-option-copy">
          <span class="comment-next-mention-option-name">{resolvedMentionName}</span>
          <small>AI 助手</small>
        </span>
      </button>
    </div>
  {/if}

  {#if selectionTools}
    <div class="comment-next-selection-bar" contenteditable="false">
      <button class="comment-next-selection-action-active" type="button">
        <CommentNextIcon name="wand" size={14} />
        改写
      </button>
      <button type="button">更清楚</button>
      <button type="button">更友好</button>
      <button type="button">更专业</button>
      <button type="button">
        <CommentNextIcon name="refresh" size={13} />
      </button>
    </div>
  {/if}
</div>

<style>
  .comment-next-editor-wrap {
    --at-apply: relative min-h-[var(--comment-next-editor-min-height,12.5rem)] overflow-visible [background:var(--comment-next-editor-surface-bg,transparent,var(--comment-next-editor-bg-color,#ffffff))];
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
  }

  .comment-next-editor-wrap-top-rounded {
    --at-apply: rounded-t-[var(--comment-next-radius-lg,0.875rem)];
  }

  .comment-next-editor-wrap::after {
    --at-apply: absolute right-4 bottom-0 left-4 h-0 border-t [border-top-style:var(--comment-next-divider-style,dashed)] [border-top-color:var(--comment-next-divider-color,#d4dde8)] bg-transparent;
    content: "";
  }

  .comment-next-editor-wrap-inline,
  .comment-next-editor-wrap-selection {
    --at-apply: [background:var(--comment-next-editor-ai-surface-bg,radial-gradient(circle_at_1.5rem_1.25rem,rgb(59_130_246_/_0.14),transparent_8rem),linear-gradient(180deg,rgb(255_255_255_/_0.98),rgb(247_252_251_/_0.98)),var(--comment-next-editor-bg-color,#ffffff))];
  }

  .comment-next-editor {
    --at-apply: box-border min-h-[var(--comment-next-editor-min-height,12.5rem)] text-[0.9375rem] text-[var(--comment-next-text-color,#172033)] leading-[1.7] outline-none caret-[var(--comment-next-primary-color,rgb(59,130,246))];
    max-width: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
    padding: var(--comment-next-editor-padding, 1.125rem 1.25rem 1.25rem);
  }

  .comment-next-editor:empty::before {
    content: attr(data-placeholder);
    --at-apply: pointer-events-none text-[var(--comment-next-placeholder-color,#8b96a7)];
  }

  .comment-next-editor :global(.comment-next-auto-link) {
    --at-apply: text-[var(--comment-next-link-color,rgb(59,130,246))] font-[620] decoration-[var(--comment-next-link-underline-color,rgb(59_130_246_/_0.35))] decoration-[0.08em] underline-offset-[0.18em] transition-[color,text-decoration-color] duration-140 ease-in-out;
  }

  .comment-next-editor :global(.comment-next-auto-link:hover) {
    --at-apply: text-[var(--comment-next-link-hover-color,rgb(37_99_235))] decoration-current;
  }

  .comment-next-editor :global(.comment-next-editor-emote-image) {
    --at-apply: mx-0.5 inline-block align-middle object-contain;
    max-width: min(100%, var(--comment-next-editor-emote-max-width, 9rem));
    max-height: var(--comment-next-editor-emote-max-height, 4.5rem);
  }

  .comment-next-editor :global(.comment-next-editor-image) {
    --at-apply: inline-block max-w-full align-middle object-contain;
  }

  .comment-next-editor :global(.comment-next-editor-lottie) {
    --at-apply: mx-0.5 inline-flex align-middle;
    max-width: 100%;
  }

  .comment-next-editor-resize-handle {
    --at-apply: absolute z-30 box-border h-3.5 w-3.5 cursor-nwse-resize rounded-[0.1875rem] border-2 border-solid border-white bg-[var(--comment-next-primary-color,rgb(59,130,246))] p-0 shadow-[0_1px_4px_rgb(15_23_42_/_0.35)];
    touch-action: none;
  }

  .comment-next-editor-resize-handle::after {
    content: "";
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 5px;
    height: 5px;
    border-right: 1px solid rgb(255 255 255 / 88%);
    border-bottom: 1px solid rgb(255 255 255 / 88%);
  }

  .comment-next-editor-paragraph {
    --at-apply: m-0;
  }

  .comment-next-selection-mark {
    --at-apply: rounded px-[0.1875rem] py-[0.0625rem] bg-[var(--comment-next-ai-mark-bg-color,rgb(191_219_254))] text-inherit shadow-[0_0_0_1px_rgb(59_130_246_/_0.16)_inset];
  }

  .comment-next-selection-bar {
    --at-apply: flex items-center;
  }

  .comment-next-mention-panel {
    --at-apply: absolute z-50 box-border rounded-[0.875rem] border border-solid [border-color:var(--comment-next-menu-border-color,#d5dde7)] bg-[var(--comment-next-menu-bg-color,#ffffff)] p-1.5 text-[var(--comment-next-text-color,#172033)] shadow-[0_18px_42px_rgb(15_23_42_/_0.16),0_1px_0_rgb(255_255_255_/_0.82)_inset];
    left: var(--comment-next-mention-left, 1rem);
    top: var(--comment-next-mention-top, 3rem);
    width: var(--comment-next-mention-width, 18rem);
    animation: comment-next-mention-in 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .comment-next-mention-option,
  .comment-next-mention-option-icon {
    --at-apply: flex items-center;
  }

  .comment-next-mention-option {
    --at-apply: min-h-12 w-full cursor-pointer gap-2.5 rounded-[0.6875rem] border-0 bg-transparent px-2.5 py-2 text-left text-[var(--comment-next-text-color,#172033)] font-inherit transition-[background-color,color,transform] duration-140 ease-in-out;
  }

  .comment-next-mention-option:hover,
  .comment-next-mention-option:focus-visible {
    --at-apply: bg-[var(--comment-next-control-hover-bg-color,#eef2f4)] text-[var(--comment-next-ai-color,rgb(59,130,246))] outline-none;
  }

  .comment-next-mention-option:active {
    --at-apply: translate-y-px;
  }

  .comment-next-mention-option-icon {
    --at-apply: h-8 w-8 flex-none justify-center rounded-lg bg-[var(--comment-next-ai-bg-color,rgb(239_246_255))] text-[var(--comment-next-ai-color,rgb(59,130,246))];
  }

  .comment-next-mention-option-copy {
    --at-apply: min-w-0 flex-1;
  }

  .comment-next-mention-option-name {
    --at-apply: block truncate text-[0.875rem] font-[760] leading-tight;
  }

  .comment-next-mention-option-copy small {
    --at-apply: mt-0.5 block truncate text-[0.75rem] text-[var(--comment-next-muted-color,#667085)] font-medium leading-tight;
  }

  .comment-next-selection-bar button {
    --at-apply: inline-flex h-7 cursor-pointer items-center justify-center gap-[0.3125rem] rounded-lg border border-solid border-transparent bg-transparent px-2.5 py-0 text-[0.8125rem] text-[var(--comment-next-muted-color,#667085)] font-[620] font-inherit transition-[background-color,border-color,color,transform] duration-150 ease-in-out;
  }

  .comment-next-selection-bar button:hover,
  .comment-next-selection-action-active {
    --at-apply: [border-color:var(--comment-next-ai-border-color,rgb(191_219_254))] bg-[var(--comment-next-ai-control-hover-bg-color,rgb(239_246_255))] text-[var(--comment-next-ai-color,rgb(59,130,246))];
  }

  .comment-next-selection-bar button:active {
    --at-apply: translate-y-px;
  }

  .comment-next-selection-bar {
    --at-apply: absolute top-14 left-5 z-3 gap-1.5 rounded-xl border border-solid [border-color:var(--comment-next-menu-border-color,#d5dde7)] bg-[var(--comment-next-menu-bg-color,#ffffff)] p-1.5 shadow-[0_14px_34px_rgb(15_23_42_/_0.14),0_1px_0_rgb(255_255_255_/_0.8)_inset];
    animation: comment-next-selection-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .comment-next-selection-bar::after {
    --at-apply: absolute bottom-[-0.3125rem] left-8 h-2.5 w-2.5 border-r border-b border-solid [border-color:var(--comment-next-menu-border-color,#d5dde7)] bg-[var(--comment-next-menu-bg-color,#ffffff)] rotate-45;
    content: "";
  }

  @keyframes comment-next-selection-in {
    from {
      opacity: 0;
      transform: translateY(0.375rem) scale(0.98);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes comment-next-mention-in {
    from {
      opacity: 0;
      transform: translateY(0.375rem) scale(0.985);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 640px) {
    .comment-next-editor-wrap {
      --at-apply: min-h-[var(--comment-next-editor-mobile-min-height,9rem)];
    }

    .comment-next-editor {
      --at-apply: min-h-[var(--comment-next-editor-mobile-min-height,9rem)];
      padding: var(
        --comment-next-editor-mobile-padding,
        var(--comment-next-editor-padding, 1rem)
      );
    }

    .comment-next-selection-bar {
      --at-apply: right-3 left-3 overflow-x-auto;
    }

    .comment-next-mention-panel {
      --at-apply: right-3 w-auto;
      left: max(0.75rem, var(--comment-next-mention-left, 0.75rem));
      max-width: calc(100% - 1.5rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-mention-panel,
    .comment-next-mention-option,
    .comment-next-selection-bar,
    .comment-next-selection-bar button {
      --at-apply: animate-none transition-none;
    }
  }
</style>
