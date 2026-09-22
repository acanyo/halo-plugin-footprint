<script lang="ts">
import type {
  CommentNextEmoteItem,
  CommentNextLottieDefaults,
} from './types/emote';

const {
  item,
  className = '',
  maxWidth = 144,
  maxHeight = 72,
  autoplay,
  hoverPlay,
  freezeOnOffscreen,
}: {
  item: CommentNextEmoteItem;
  className?: string;
  maxWidth?: number;
  maxHeight?: number;
  autoplay?: boolean;
  hoverPlay?: boolean;
  freezeOnOffscreen?: boolean;
} = $props();

const defaults = $derived(item.defaults ?? defaultDefaults());
const dimensions = $derived(resolveDimensions(defaults, maxWidth, maxHeight));
const resolvedAutoplay = $derived(autoplay ?? defaults.autoplay);
const resolvedHoverPlay = $derived(hoverPlay ?? defaults.hoverPlay);
const resolvedFreezeOnOffscreen = $derived(
  freezeOnOffscreen ?? defaults.freezeOnOffscreen
);

function defaultDefaults(): CommentNextLottieDefaults {
  return {
    width: 160,
    height: 160,
    autoplay: false,
    loop: true,
    speed: 1,
    fit: 'contain',
    align: 'center',
    controls: false,
    hoverPlay: true,
    freezeOnOffscreen: true,
    ariaLabel: '',
  };
}

function resolveDimensions(value: CommentNextLottieDefaults, maxWidth: number, maxHeight: number) {
  const width = Number.isFinite(value.width) && value.width > 0 ? value.width : 160;
  const height = Number.isFinite(value.height) && value.height > 0 ? value.height : 160;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
</script>

<halo-lottie
  class={className}
  src={item.contentUrl}
  format={item.format || 'json'}
  width={dimensions.width}
  height={dimensions.height}
  autoplay={resolvedAutoplay ? 'true' : 'false'}
  loop={defaults.loop ? 'true' : 'false'}
  speed={defaults.speed}
  fit={defaults.fit}
  align={defaults.align}
  controls={defaults.controls ? 'true' : 'false'}
  hover-play={resolvedHoverPlay ? 'true' : 'false'}
  freeze-on-offscreen={resolvedFreezeOnOffscreen ? 'true' : 'false'}
  aria-label={defaults.ariaLabel || item.label}
></halo-lottie>
