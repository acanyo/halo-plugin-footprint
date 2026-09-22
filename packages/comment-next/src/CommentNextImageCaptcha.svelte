<script lang="ts">
import CommentNextIcon from './CommentNextIcon.svelte';
import { fetchCaptchaImage } from './services/captcha';

const {
  baseUrl = '',
  image = '',
  refreshKey = 0,
  value = '',
  disabled = false,
  onChange = () => {},
}: {
  baseUrl?: string;
  image?: string;
  refreshKey?: number;
  value?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
} = $props();

let captchaImage = $state('');
let loading = $state(false);
let error = $state('');
let lastBaseUrl = $state<string | undefined>();
let lastImage = $state<string | undefined>();
let lastRefreshKey = $state<number | undefined>();

$effect(() => {
  if (image && image !== lastImage) {
    lastImage = image;
    captchaImage = image;
    error = '';
  }
});

$effect(() => {
  if (!image && (lastBaseUrl !== baseUrl || lastRefreshKey !== refreshKey)) {
    lastBaseUrl = baseUrl;
    lastRefreshKey = refreshKey;
    void refreshCaptcha();
  }
});

async function refreshCaptcha() {
  if (disabled) {
    return;
  }

  try {
    loading = true;
    error = '';
    captchaImage = await fetchCaptchaImage(baseUrl);
    onChange('');
  } catch (captchaError) {
    console.error(captchaError);
    error = '验证码加载失败';
  } finally {
    loading = false;
  }
}
</script>

<div class="comment-next-image-captcha" aria-label="图片验证码">
  <button
    class="comment-next-image-captcha-preview"
    type="button"
    disabled={disabled || loading}
    title="点击刷新验证码"
    onclick={refreshCaptcha}
  >
    {#if loading}
      <span class="comment-next-image-captcha-loading">
        <CommentNextIcon name="loader" size={16} />
      </span>
    {:else if captchaImage}
      <img class="comment-next-image-captcha-image" src={captchaImage} alt="验证码" />
    {:else}
      <span class="comment-next-image-captcha-placeholder">刷新</span>
    {/if}
  </button>
  <input
    class="comment-next-image-captcha-input"
    name="captchaCode"
    autocomplete="off"
    inputmode="text"
    placeholder={error || "输入验证码"}
    value={value}
    disabled={disabled}
    oninput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
  />
</div>

<style>
  .comment-next-image-captcha {
    --at-apply: flex w-full items-center gap-2;
  }

  .comment-next-image-captcha-preview {
    --at-apply: inline-flex h-10 w-30 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[0.625rem] border border-solid [border-color:var(--comment-next-border-subtle-color,#dfe5ec)] bg-[var(--comment-next-field-bg-color,#fbfcfd)] p-0 text-[var(--comment-next-muted-color,#6b7687)] font-inherit disabled:cursor-wait disabled:opacity-72;
  }

  .comment-next-image-captcha-image {
    --at-apply: block h-full w-full object-cover;
  }

  .comment-next-image-captcha-input {
    --at-apply: h-10 min-w-0 flex-1 rounded-[0.625rem] border border-solid [border-color:var(--comment-next-border-subtle-color,#dfe5ec)] bg-[var(--comment-next-field-bg-color,#fbfcfd)] px-3 text-sm text-[var(--comment-next-text-color,#172033)] outline-none transition-[border-color,box-shadow] duration-140 ease-in-out;
  }

  .comment-next-image-captcha-input:focus {
    --at-apply: [border-color:var(--comment-next-focus-border-color,#aeb9c6)] shadow-[0_0_0_3px_var(--comment-next-focus-shadow-color,rgb(59_130_246_/_0.14))];
  }

  .comment-next-image-captcha-loading {
    --at-apply: inline-flex animate-spin;
  }

  .comment-next-image-captcha-placeholder {
    --at-apply: text-xs font-[650];
  }
</style>
