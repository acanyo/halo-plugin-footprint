<script lang="ts">
import CommentNextAvatar from './CommentNextAvatar.svelte';
import CommentNextIcon from './CommentNextIcon.svelte';

const {
  visible = true,
  loggedIn = false,
  avatarUrl = '',
  avatarAlt = '',
  userDisplayName = '',
  displayName = '',
  email = '',
  website = '',
  onChange = () => {},
  onEmailBlur = () => {},
}: {
  visible?: boolean;
  loggedIn?: boolean;
  avatarUrl?: string;
  avatarAlt?: string;
  userDisplayName?: string;
  displayName?: string;
  email?: string;
  website?: string;
  onChange?: (values: {
    displayName: string;
    email: string;
    website: string;
  }) => void;
  onEmailBlur?: (email: string) => void;
} = $props();

function updateField(
  field: 'displayName' | 'email' | 'website',
  value: string
) {
  onChange({
    displayName,
    email,
    website,
    [field]: value,
  });
}
</script>

{#if visible}
  <div class:comment-next-account-fields-logged-in={loggedIn} class="comment-next-account-fields" aria-label="评论身份">
    <div class="comment-next-account-avatar">
      <CommentNextAvatar src={avatarUrl} alt={avatarAlt || displayName || userDisplayName} size={34} />
    </div>

    {#if loggedIn}
      <div class="comment-next-account-current-user">
        <span class="comment-next-account-current-label">当前账号</span>
        <span class="comment-next-account-current-name">{userDisplayName || "已登录用户"}</span>
      </div>
    {:else}
      <label class="comment-next-field">
        <span class="comment-next-field-icon" aria-hidden="true">
          <CommentNextIcon name="user" size={16} />
        </span>
        <input
          name="displayName"
          type="text"
          placeholder="昵称"
          autocomplete="name"
          value={displayName}
          required
          oninput={(event) => updateField("displayName", event.currentTarget.value)}
        />
      </label>
      <label class="comment-next-field">
        <span class="comment-next-field-icon" aria-hidden="true">
          <CommentNextIcon name="mail" size={16} />
        </span>
        <input
          name="email"
          type="email"
          placeholder="邮箱"
          autocomplete="email"
          value={email}
          required
          oninput={(event) => updateField("email", event.currentTarget.value)}
          onblur={(event) => onEmailBlur(event.currentTarget.value)}
        />
      </label>
      <label class="comment-next-field">
        <span class="comment-next-field-icon" aria-hidden="true">
          <CommentNextIcon name="globe" size={16} />
        </span>
        <input
          name="website"
          type="url"
          placeholder="网站（可选）"
          autocomplete="url"
          value={website}
          oninput={(event) => updateField("website", event.currentTarget.value)}
        />
      </label>
    {/if}
  </div>
{/if}

<style>
  .comment-next-account-fields {
    --at-apply: grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-0 box-border border-b [border-bottom-style:var(--comment-next-divider-style,dashed)] [border-bottom-color:var(--comment-next-divider-color,#d4dde8)] rounded-t-[var(--comment-next-radius-lg,0.875rem)] bg-[var(--comment-next-account-fields-bg,transparent)] px-3.5 py-2.5;
  }

  .comment-next-account-fields-logged-in {
    --at-apply: grid-cols-[auto_minmax(0,1fr)];
  }

  .comment-next-account-avatar {
    --at-apply: flex items-center justify-center pr-3;
  }

  .comment-next-account-current-user {
    --at-apply: flex min-w-0 items-baseline gap-2;
  }

  .comment-next-account-current-label {
    --at-apply: whitespace-nowrap text-[0.78125rem] text-[var(--comment-next-muted-color,#6b7687)] font-[620];
  }

  .comment-next-account-current-name {
    --at-apply: min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.9375rem] text-[var(--comment-next-text-color,#172033)] font-[760];
  }

  .comment-next-field {
    --at-apply: relative flex h-9 min-w-0 box-border items-center gap-2.5 rounded-[0.625rem] border-0 bg-transparent px-3.5 py-0 text-[var(--comment-next-muted-color,#6b7687)] transition-[box-shadow,background-color,color] duration-140 ease-in-out;
  }

  .comment-next-field + .comment-next-field::before {
    --at-apply: absolute top-[0.45rem] bottom-[0.45rem] left-0 w-px;
    background-image: linear-gradient(
      to bottom,
      var(--comment-next-field-divider-color, #dbe4ed) 45%,
      transparent 0
    );
    background-size: 1px 0.375rem;
    content: "";
    --at-apply: transition-opacity duration-140 ease-in-out;
  }

  .comment-next-field:focus-within {
    --at-apply: bg-[var(--comment-next-field-focus-bg-color,#ffffff)] text-[var(--comment-next-primary-color,rgb(59,130,246))] shadow-[0_6px_14px_rgb(15_23_42_/_0.05),0_0_0_1px_var(--comment-next-primary-color,rgb(59,130,246))_inset];
  }

  .comment-next-field:focus-within::before,
  .comment-next-field:focus-within + .comment-next-field::before {
    --at-apply: opacity-0;
  }

  .comment-next-field-icon {
    --at-apply: inline-flex w-[1.125rem] items-center justify-center text-current opacity-92;
  }

  .comment-next-field input {
    --at-apply: min-w-0 w-full border-0 bg-transparent text-[0.90625rem] text-[var(--comment-next-text-color,#172033)] font-medium font-inherit outline-none;
  }

  .comment-next-field input::placeholder {
    --at-apply: text-[var(--comment-next-placeholder-color,#8a95a5)] font-medium;
  }

  @media (max-width: 720px) {
    .comment-next-account-fields {
      --at-apply: grid-cols-[auto_minmax(0,1fr)] gap-0.5 p-2.5;
    }

    .comment-next-account-fields:not(.comment-next-account-fields-logged-in) .comment-next-account-avatar {
      --at-apply: row-span-3 self-start pt-1;
    }

    .comment-next-account-fields:not(.comment-next-account-fields-logged-in) .comment-next-field {
      --at-apply: col-start-2;
    }

    .comment-next-field + .comment-next-field::before {
      --at-apply: top-[-0.0625rem] right-3 bottom-auto left-3 h-px w-auto;
      background-image: linear-gradient(
        to right,
        var(--comment-next-field-divider-color, #dbe4ed) 45%,
        transparent 0
      );
      background-size: 0.375rem 1px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comment-next-field {
      --at-apply: transition-none;
    }
  }
</style>
