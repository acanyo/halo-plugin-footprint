const IMAGE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

const IMAGE_CONTENT_TYPE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/vnd.microsoft.icon': 'image/x-icon',
};

const DEFAULT_IMAGE_FILENAME_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'image.jpg',
  'image/png': 'image.png',
  'image/gif': 'image.gif',
  'image/webp': 'image.webp',
  'image/avif': 'image.avif',
  'image/bmp': 'image.bmp',
  'image/heic': 'image.heic',
  'image/heif': 'image.heif',
  'image/svg+xml': 'image.svg',
  'image/tiff': 'image.tiff',
  'image/x-icon': 'image.ico',
};

const GENERIC_BINARY_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

type ImageFileLike = Pick<File, 'name' | 'type'>;

export function normalizeImageContentType(contentType: string | undefined): string {
  const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

  return IMAGE_CONTENT_TYPE_ALIASES[normalizedContentType] ?? normalizedContentType;
}

export function inferImageContentType(file: ImageFileLike): string {
  const declaredContentType = normalizeImageContentType(file.type);

  if (declaredContentType && !GENERIC_BINARY_CONTENT_TYPES.has(declaredContentType)) {
    return declaredContentType;
  }

  const extension = file.name.split('.').pop()?.trim().toLowerCase() ?? '';

  return IMAGE_CONTENT_TYPE_BY_EXTENSION[extension] ?? '';
}

export function isImageFile(file: ImageFileLike): boolean {
  return inferImageContentType(file).startsWith('image/');
}

export function isImageContentType(contentType: string): boolean {
  return normalizeImageContentType(contentType).startsWith('image/');
}

export function toUploadableImageFile(file: File): File {
  const inferredContentType = inferImageContentType(file);
  const declaredContentType = normalizeImageContentType(file.type);

  if (!inferredContentType || declaredContentType === inferredContentType) {
    return file;
  }

  return new File(
    [file],
    file.name || DEFAULT_IMAGE_FILENAME_BY_TYPE[inferredContentType] || 'image',
    {
      type: inferredContentType,
      lastModified: file.lastModified,
    }
  );
}
