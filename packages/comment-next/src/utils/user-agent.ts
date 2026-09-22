export type CommentNextEnvironmentTagType = 'os' | 'browser';

export interface CommentNextEnvironmentTag {
  type: CommentNextEnvironmentTagType;
  label: string;
  iconClass: string;
  title: string;
  color?: string;
}

export interface CommentNextEnvironmentTagOptions {
  userAgent?: string;
}

export function getCommentEnvironmentTags({
  userAgent,
}: CommentNextEnvironmentTagOptions): CommentNextEnvironmentTag[] {
  return [resolveOsTag(userAgent), resolveBrowserTag(userAgent)].filter(
    Boolean
  ) as CommentNextEnvironmentTag[];
}

export function getUserAgentTags(userAgent?: string): string[] {
  return getCommentEnvironmentTags({ userAgent }).map((tag) => tag.label);
}

const OS_ICON_CLASSES = {
  windows: 'i-logos:microsoft-windows-icon',
  macos: 'i-logos:apple',
  linux: 'i-logos:linux-tux',
  android: 'i-logos:android-icon',
  ios: 'i-logos:apple',
  chromeos: 'i-logos:chrome',
  arch: 'i-logos:archlinux',
  manjaro: 'i-logos:manjaro',
  ubuntu: 'i-logos:ubuntu',
  fedora: 'i-logos:fedora',
  harmonyos: 'i-simple-icons:harmonyos',
} as const;

const BROWSER_ICON_CLASSES = {
  chrome: 'i-logos:chrome',
  firefox: 'i-logos:firefox',
  safari: 'i-logos:safari',
  edge: 'i-logos:microsoft-edge',
  opera: 'i-logos:opera',
  huawei: 'i-simple-icons:huawei',
  xiaomi: 'i-simple-icons:xiaomi',
} as const;

function resolveOsTag(
  userAgent?: string
): CommentNextEnvironmentTag | undefined {
  if (!userAgent?.trim()) {
    return undefined;
  }

  const normalized = userAgent.replaceAll('_', '.');

  const macOsMatch = normalized.match(/Mac OS X\s+([\d.]+)/i);
  if (macOsMatch?.[1]) {
    return osTag(`macOS ${macOsMatch[1]}`, OS_ICON_CLASSES.macos);
  }

  const iosMatch = normalized.match(/(?:iPhone OS|CPU OS)\s+([\d.]+)/i);
  if (iosMatch?.[1]) {
    return osTag(`iOS ${iosMatch[1]}`, OS_ICON_CLASSES.ios);
  }

  const androidMatch = normalized.match(/Android\s+([\d.]+)/i);
  if (androidMatch?.[1]) {
    return osTag(`Android ${androidMatch[1]}`, OS_ICON_CLASSES.android);
  }

  if (/Windows NT/i.test(userAgent)) {
    return osTag('Windows', OS_ICON_CLASSES.windows);
  }

  if (/CrOS/i.test(userAgent)) {
    return osTag('Chrome OS', OS_ICON_CLASSES.chromeos);
  }

  if (/HarmonyOS|OpenHarmony/i.test(userAgent)) {
    return osTag('HarmonyOS', OS_ICON_CLASSES.harmonyos, '#111827');
  }

  if (/Arch Linux|ArchLinux|Arch/i.test(userAgent)) {
    return osTag('Arch', OS_ICON_CLASSES.arch);
  }

  if (/Manjaro/i.test(userAgent)) {
    return osTag('Manjaro', OS_ICON_CLASSES.manjaro);
  }

  if (/Ubuntu/i.test(userAgent)) {
    return osTag('Ubuntu', OS_ICON_CLASSES.ubuntu);
  }

  if (/Fedora/i.test(userAgent)) {
    return osTag('Fedora', OS_ICON_CLASSES.fedora);
  }

  if (/Linux/i.test(userAgent)) {
    return osTag('Linux', OS_ICON_CLASSES.linux);
  }

  return undefined;
}

function resolveBrowserTag(
  userAgent?: string
): CommentNextEnvironmentTag | undefined {
  if (!userAgent?.trim()) {
    return undefined;
  }

  const edgeMatch = userAgent.match(/(?:Edg|EdgiOS|EdgA)\/([\d.]+)/i);
  if (edgeMatch?.[1]) {
    return browserTag(
      `Microsoft Edge ${edgeMatch[1]}`,
      BROWSER_ICON_CLASSES.edge
    );
  }

  const operaMatch = userAgent.match(/(?:OPR|Opera)\/([\d.]+)/i);
  if (operaMatch?.[1]) {
    return browserTag(`Opera ${operaMatch[1]}`, BROWSER_ICON_CLASSES.opera);
  }

  const huaweiMatch = userAgent.match(/HuaweiBrowser\/([\d.]+)/i);
  if (huaweiMatch?.[1]) {
    return browserTag(
      `Huawei Browser ${huaweiMatch[1]}`,
      BROWSER_ICON_CLASSES.huawei,
      '#D6000B'
    );
  }

  const miuiMatch = userAgent.match(/MiuiBrowser\/([\d.]+)/i);
  if (miuiMatch?.[1]) {
    return browserTag(
      `MIUI Browser ${miuiMatch[1]}`,
      BROWSER_ICON_CLASSES.xiaomi,
      '#FF6901'
    );
  }

  const chromeMatch = userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/i);
  if (chromeMatch?.[1]) {
    return browserTag(`Chrome ${chromeMatch[1]}`, BROWSER_ICON_CLASSES.chrome);
  }

  const firefoxMatch = userAgent.match(/(?:Firefox|FxiOS)\/([\d.]+)/i);
  if (firefoxMatch?.[1]) {
    return browserTag(
      `Firefox ${firefoxMatch[1]}`,
      BROWSER_ICON_CLASSES.firefox
    );
  }

  const safariMatch = userAgent.match(/Version\/([\d.]+).*Safari/i);
  if (safariMatch?.[1]) {
    return browserTag(`Safari ${safariMatch[1]}`, BROWSER_ICON_CLASSES.safari);
  }

  return undefined;
}

function osTag(
  label: string,
  iconClass: string,
  color?: string
): CommentNextEnvironmentTag {
  return {
    type: 'os',
    label,
    iconClass,
    color,
    title: '操作系统',
  };
}

function browserTag(
  label: string,
  iconClass: string,
  color?: string
): CommentNextEnvironmentTag {
  return {
    type: 'browser',
    label,
    iconClass,
    color,
    title: '浏览器',
  };
}
