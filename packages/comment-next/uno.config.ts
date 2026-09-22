import { defineConfig, presetIcons, presetWind3 } from 'unocss';

const commentNextIconSafelist = [
  'i-logos:apple',
  'i-logos:microsoft-windows-icon',
  'i-logos:linux-tux',
  'i-logos:android-icon',
  'i-logos:chrome',
  'i-logos:archlinux',
  'i-logos:manjaro',
  'i-logos:ubuntu',
  'i-logos:fedora',
  'i-logos:firefox',
  'i-logos:safari',
  'i-logos:microsoft-edge',
  'i-logos:opera',
  'i-simple-icons:harmonyos',
  'i-simple-icons:huawei',
  'i-simple-icons:xiaomi',
];

export default defineConfig({
  presets: [
    presetWind3(),
    presetIcons({
      warn: true,
    }),
  ],
  safelist: commentNextIconSafelist,
  shortcuts: {
    'bg-comment-next': 'bg-[var(--comment-next-bg-color,#fff)]',
    'border-comment-next': 'border-[var(--comment-next-border-color,#d8dee7)]',
    'text-comment-next': 'text-[var(--comment-next-text-color,#172033)]',
    'text-comment-next-muted': 'text-[var(--comment-next-muted-color,#6b7687)]',
  },
});
