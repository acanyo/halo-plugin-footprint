import { defineConfig, presetIcons, presetWind3 } from 'unocss';

export default defineConfig({
  presets: [
    presetWind3(),
    presetIcons({
      warn: true,
    }),
  ],
  shortcuts: {
    'bg-footprint': 'bg-[var(--footprint-bg-color,#fff)]',
    'bg-footprint-surface': 'bg-[var(--footprint-surface-bg-color,#fff)]',
    'border-footprint': 'border-[var(--footprint-border-color,#d8dee7)]',
    'text-footprint': 'text-[var(--footprint-text-color,#172033)]',
    'text-footprint-muted': 'text-[var(--footprint-muted-color,#6b7687)]',
  },
});
