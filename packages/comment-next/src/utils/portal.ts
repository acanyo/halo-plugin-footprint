const PORTAL_VARIABLE_PREFIXES = ['--comment-next-', '--halo-cw-'];
const PORTAL_STYLE_ID = 'comment-next-portal-styles';

type PortalOptions = {
  style?: string;
};

export function portalToBody(node: HTMLElement, options: PortalOptions = {}) {
  if (typeof document === 'undefined') {
    return {};
  }

  ensurePortalStyles();
  const styleSource = resolveStyleSource(node);
  applyPortalInlineStyle(styleSource, node, options);
  document.body.appendChild(node);

  return {
    update(nextOptions: PortalOptions = {}) {
      applyPortalInlineStyle(styleSource, node, nextOptions);
    },
    destroy() {
      node.remove();
    },
  };
}

function resolveStyleSource(node: HTMLElement): Element {
  const root = node.getRootNode();

  if (root instanceof ShadowRoot) {
    return root.host;
  }

  return node.parentElement ?? document.documentElement;
}

function copyPortalVariables(source: Element, target: HTMLElement) {
  const sourceStyle = getComputedStyle(source);

  for (let index = 0; index < sourceStyle.length; index += 1) {
    const property = sourceStyle.item(index);

    if (
      !PORTAL_VARIABLE_PREFIXES.some((prefix) => property.startsWith(prefix))
    ) {
      continue;
    }

    const value = sourceStyle.getPropertyValue(property);

    if (value) {
      target.style.setProperty(property, value);
    }
  }
}

function applyPortalInlineStyle(
  source: Element,
  target: HTMLElement,
  options: PortalOptions
) {
  target.removeAttribute('style');

  if (options.style?.trim()) {
    target.setAttribute('style', options.style);
  }

  copyPortalVariables(source, target);
}

function ensurePortalStyles() {
  const existingStyle = document.getElementById(PORTAL_STYLE_ID);
  const style =
    existingStyle instanceof HTMLStyleElement
      ? existingStyle
      : document.createElement('style');
  style.id = PORTAL_STYLE_ID;
  style.textContent = `
.comment-next-report-dialog-shell,
.comment-next-image-lightbox-shell,
.comment-next-ai-panel-layer {
  box-sizing: border-box;
  font-family: var(--comment-next-dialog-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: 0;
  text-transform: none;
  color: var(--comment-next-text-color, #172033);
  -webkit-font-smoothing: antialiased;
  text-rendering: auto;
}
.comment-next-report-dialog-shell *,
.comment-next-report-dialog-shell *::before,
.comment-next-report-dialog-shell *::after,
.comment-next-image-lightbox-shell *,
.comment-next-image-lightbox-shell *::before,
.comment-next-image-lightbox-shell *::after,
.comment-next-ai-panel-layer *,
.comment-next-ai-panel-layer *::before,
.comment-next-ai-panel-layer *::after {
  box-sizing: border-box;
}
.comment-next-report-dialog-shell button,
.comment-next-report-dialog-shell input,
.comment-next-report-dialog-shell textarea,
.comment-next-image-lightbox-shell button,
.comment-next-ai-panel-layer button {
  font: inherit;
  letter-spacing: 0;
  text-transform: none;
}
.comment-next-report-dialog-shell button,
.comment-next-report-dialog-shell textarea,
.comment-next-ai-panel-layer button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}
.comment-next-report-dialog-shell {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  width: min(30rem, calc(100vw - 2rem));
  max-width: none;
  height: fit-content;
  margin: auto;
  padding: 0;
  overflow: visible;
  border: 0;
  background: transparent;
  color: var(--comment-next-text-color, #172033);
  isolation: isolate;
}
.comment-next-report-dialog-shell::backdrop {
  background: var(--comment-next-modal-backdrop-color, rgb(2 6 23 / 0.68));
  backdrop-filter: blur(4px) saturate(0.9);
}
.comment-next-report-dialog {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--comment-next-border-subtle-color, #e7ecf2);
  background: var(--comment-next-modal-bg-color, #fff);
  padding: 1rem;
  color: var(--comment-next-text-color, #172033);
  box-shadow: 0 24px 60px rgb(15 23 42 / 0.22);
}
.comment-next-report-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.comment-next-report-dialog-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 780;
  line-height: 1.5rem;
}
.comment-next-report-dialog-header p {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  line-height: 1.25rem;
  color: var(--comment-next-muted-color, #6b7687);
}
.comment-next-report-dialog-close {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: none;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--comment-next-muted-color, #6b7687);
  box-shadow: none;
  transition: background-color 140ms ease, color 140ms ease;
}
.comment-next-report-dialog-close:hover {
  background: var(--comment-next-muted-bg-color, #f4f6f8);
  color: var(--comment-next-text-color, #172033);
}
.comment-next-report-reasons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
.comment-next-report-reason {
  display: flex;
  min-width: 0;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.5rem;
  border-radius: 7px;
  border: 1px solid var(--comment-next-border-subtle-color, #e7ecf2);
  background: transparent;
  padding: 0.5rem 0.625rem;
  text-align: left;
  transition: border-color 140ms ease, background-color 140ms ease;
}
.comment-next-report-reason:hover,
.comment-next-report-reason-active {
  border-color: var(--comment-next-primary-color, rgb(59, 130, 246));
  background: var(--comment-next-primary-soft-bg-color, rgb(59 130 246 / 0.08));
}
.comment-next-report-reason input[type="radio"] {
  width: 0.875rem;
  height: 0.875rem;
  flex: none;
  margin: 0.125rem 0 0;
  border-radius: 9999px;
  border: 1px solid var(--comment-next-border-color, #d7dee8);
  background: var(--comment-next-modal-input-bg-color, #fff);
  padding: 0;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  box-shadow: 0 0 0 1px rgb(15 23 42 / 0.02);
  transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}
.comment-next-report-reason input[type="radio"]:checked {
  border-color: var(--comment-next-primary-color, rgb(59, 130, 246));
  background: radial-gradient(circle at center, var(--comment-next-primary-color, rgb(59, 130, 246)) 0 42%, transparent 46%), var(--comment-next-modal-input-bg-color, #fff);
  box-shadow: 0 0 0 3px var(--comment-next-primary-ring-color, rgb(59 130 246 / 0.12));
}
.comment-next-report-reason input[type="radio"]:focus-visible {
  box-shadow: 0 0 0 3px var(--comment-next-primary-ring-color, rgb(59 130 246 / 0.16));
}
.comment-next-report-reason span {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}
.comment-next-report-reason strong {
  font-size: 0.8125rem;
  font-weight: 720;
  line-height: 1.25rem;
}
.comment-next-report-reason small {
  font-size: 0.75rem;
  line-height: 1.15rem;
  color: var(--comment-next-muted-color, #6b7687);
}
.comment-next-report-description {
  display: grid;
  gap: 0.375rem;
  margin-top: 0.75rem;
}
.comment-next-report-description span {
  font-size: 0.75rem;
  font-weight: 680;
  color: var(--comment-next-muted-color, #6b7687);
}
.comment-next-report-description textarea {
  width: 100%;
  min-height: 6rem;
  resize: vertical;
  border-radius: 7px;
  border: 1px solid var(--comment-next-border-color, #d7dee8);
  background: var(--comment-next-modal-input-bg-color, #fff);
  padding: 0.5rem 0.75rem;
  color: var(--comment-next-text-color, #172033);
  font-size: 0.875rem;
  line-height: 1.5rem;
  outline: none;
  box-shadow: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.comment-next-report-description textarea::placeholder {
  color: var(--comment-next-placeholder-color, #8b96a7);
  opacity: 1;
}
.comment-next-report-description textarea:focus {
  border-color: var(--comment-next-primary-color, rgb(59, 130, 246));
  box-shadow: 0 0 0 3px var(--comment-next-primary-ring-color, rgb(59 130 246 / 0.16));
}
.comment-next-report-dialog-meta {
  display: flex;
  min-height: 1.25rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--comment-next-muted-color, #6b7687);
}
.comment-next-report-dialog-meta strong {
  text-align: right;
  color: var(--comment-next-error-color, #dc2626);
  font-weight: 650;
}
.comment-next-report-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
.comment-next-report-dialog-actions button {
  display: inline-flex;
  height: 2.25rem;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: 7px;
  border: 1px solid;
  padding: 0 0.875rem;
  font-size: 0.875rem;
  font-weight: 700;
  box-shadow: none;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease;
}
.comment-next-report-dialog-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.comment-next-report-dialog-cancel {
  border-color: var(--comment-next-border-color, #d7dee8);
  background: transparent;
  color: var(--comment-next-muted-color, #6b7687);
}
.comment-next-report-dialog-cancel:hover {
  background: var(--comment-next-muted-bg-color, #f4f6f8);
  color: var(--comment-next-text-color, #172033);
}
.comment-next-report-dialog-submit {
  border-color: transparent;
  background: var(--comment-next-primary-color, rgb(59, 130, 246));
  color: #fff;
}
.comment-next-report-dialog-submit:hover {
  background: var(--comment-next-primary-hover-color, #2563eb);
}
.comment-next-image-lightbox-shell {
  position: fixed;
  inset: 0;
  z-index: 2147483010;
  width: 100vw;
  max-width: none;
  height: 100vh;
  max-height: none;
  margin: 0;
  padding: clamp(1rem, 3vw, 2.5rem);
  overflow: hidden;
  border: 0;
  background: rgb(2 6 23 / 0.94);
  color: #fff;
}
.comment-next-image-lightbox-shell::backdrop {
  background: rgb(2 6 23 / 0.94);
}
.comment-next-image-lightbox-stage {
  display: flex;
  width: 100%;
  height: 100%;
  margin: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.75rem;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  cursor: zoom-out;
}
.comment-next-image-lightbox-stage img {
  display: block;
  max-width: min(100%, 100rem);
  max-height: calc(100vh - 7rem);
  border-radius: 0.5rem;
  object-fit: contain;
  cursor: default;
  pointer-events: none;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.42);
}
.comment-next-image-lightbox-caption {
  max-width: min(42rem, 90vw);
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(226 232 240 / 0.9);
  font-size: 0.8125rem;
  line-height: 1.25rem;
}
.comment-next-image-lightbox-close {
  position: fixed;
  z-index: 1;
  top: max(1rem, env(safe-area-inset-top));
  right: max(1rem, env(safe-area-inset-right));
  display: inline-flex;
  width: 2.5rem;
  height: 2.5rem;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid rgb(255 255 255 / 0.16);
  background: rgb(15 23 42 / 0.72);
  padding: 0;
  color: #fff;
  transition: background-color 140ms ease, transform 140ms ease;
}
.comment-next-image-lightbox-close:hover {
  background: rgb(30 41 59 / 0.96);
}
.comment-next-image-lightbox-close:active {
  transform: scale(0.95);
}
.comment-next-image-lightbox-close:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.comment-next-ai-panel-layer {
  position: fixed;
  z-index: 2147482990;
  left: var(--comment-next-ai-panel-left, 1rem);
  top: var(--comment-next-ai-panel-top, auto);
  bottom: var(--comment-next-ai-panel-bottom, auto);
  width: min(17.25rem, calc(100vw - 2rem));
}
.comment-next-ai-panel-backdrop {
  display: none;
}
.comment-next-ai-panel {
  position: relative;
  width: 100%;
  max-height: min(16rem, calc(100vh - 2rem));
  overflow: auto;
  border-radius: 0.5rem;
  border: 1px solid var(--comment-next-menu-border-color, #d5dde7);
  background: var(--comment-next-modal-bg-color, #fff);
  padding: 0.375rem;
  color: var(--comment-next-text-color, #172033);
  box-shadow: 0 14px 34px rgb(15 23 42 / 0.14), 0 1px 0 rgb(255 255 255 / 0.82) inset;
  animation: comment-next-ai-menu-in 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.comment-next-ai-panel-list {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.125rem;
}
.comment-next-ai-panel-close {
  position: absolute;
  right: 0.375rem;
  top: 0.375rem;
  z-index: 1;
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--comment-next-muted-color, #667085);
  transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;
}
.comment-next-ai-panel-close:hover {
  background: var(--comment-next-control-hover-bg-color, #eef2f4);
  color: var(--comment-next-text-color, #172033);
}
.comment-next-ai-panel-close:active {
  transform: scale(0.94);
}
.comment-next-ai-panel-command {
  display: flex;
  min-height: 2.5rem;
  width: 100%;
  cursor: pointer;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.375rem;
  border: 0;
  background: transparent;
  padding: 0.375rem 0.5rem;
  text-align: left;
  color: var(--comment-next-text-color, #172033);
  transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;
}
.comment-next-ai-panel-command:first-child {
  padding-right: 2rem;
}
.comment-next-ai-panel-command-icon {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  color: var(--comment-next-ai-color, rgb(59, 130, 246));
}
.comment-next-ai-panel-command-copy {
  min-width: 0;
  flex: 1;
}
.comment-next-ai-panel-command-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 720;
  line-height: 1.15;
}
.comment-next-ai-panel-command-hint {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 0.125rem;
  font-size: 0.71875rem;
  font-weight: 500;
  line-height: 1.15;
  color: var(--comment-next-muted-color, #667085);
}
.comment-next-ai-panel-command:hover,
.comment-next-ai-panel-command-active {
  background: var(--comment-next-control-hover-bg-color, #eef2f4);
  color: var(--comment-next-ai-color, rgb(59, 130, 246));
}
.comment-next-ai-panel-command:hover .comment-next-ai-panel-command-icon,
.comment-next-ai-panel-command-active .comment-next-ai-panel-command-icon {
  background: var(--comment-next-ai-bg-color, rgb(239 246 255));
}
.comment-next-ai-panel-command:active {
  transform: translateY(1px);
}
.comment-next-ai-panel-command:disabled {
  cursor: wait;
  opacity: 0.64;
}
@keyframes comment-next-ai-menu-in {
  from {
    opacity: 0;
    transform: translateY(0.375rem) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes comment-next-ai-sheet-in {
  from {
    opacity: 0;
    transform: translateY(1rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 640px) {
  .comment-next-report-dialog-shell {
    inset: auto 0.75rem 0.75rem;
    width: auto;
  }
  .comment-next-image-lightbox-shell {
    padding: 1rem;
  }
  .comment-next-image-lightbox-stage img {
    max-height: calc(100vh - 6rem);
    border-radius: 0.375rem;
  }
  .comment-next-report-dialog {
    max-width: none;
    padding: 0.875rem;
  }
  .comment-next-report-reasons {
    grid-template-columns: 1fr;
  }
  .comment-next-report-dialog-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .comment-next-ai-panel-layer {
    inset: 0;
    width: auto;
    pointer-events: none;
  }
  .comment-next-ai-panel-backdrop {
    position: absolute;
    inset: 0;
    display: block;
    cursor: default;
    border: 0;
    background: rgb(15 23 42 / 0.28);
    padding: 0;
    pointer-events: auto;
  }
  .comment-next-ai-panel {
    position: absolute;
    left: 0.75rem;
    right: 0.75rem;
    bottom: calc(0.75rem + env(safe-area-inset-bottom));
    width: auto;
    border-radius: 1.125rem;
    padding: 0.5rem;
    pointer-events: auto;
    box-shadow: 0 24px 64px rgb(15 23 42 / 0.28), 0 1px 0 rgb(255 255 255 / 0.82) inset;
    animation: comment-next-ai-sheet-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .comment-next-ai-panel-list {
    gap: 0.25rem;
  }
  .comment-next-ai-panel-command {
    min-height: 3.5rem;
    padding: 0.625rem 0.75rem;
  }
  .comment-next-ai-panel-command-icon {
    width: 2.25rem;
    height: 2.25rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .comment-next-ai-panel,
  .comment-next-ai-panel-command,
  .comment-next-ai-panel-close,
  .comment-next-report-dialog-actions button,
  .comment-next-report-dialog-close,
  .comment-next-image-lightbox-close,
  .comment-next-report-reason {
    animation: none;
    transition: none;
  }
}
`;

  if (!existingStyle) {
    document.head.appendChild(style);
  }
}
