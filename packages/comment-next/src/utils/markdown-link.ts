export function unwrapMarkdownLink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) {
    return trimmed;
  }

  const separator = trimmed.indexOf('](');
  if (separator < 0 || !trimmed.endsWith(')')) {
    return trimmed;
  }

  const closeLength = trimmed.endsWith('\\)') ? 2 : 1;
  return trimmed
    .slice(separator + 2, trimmed.length - closeLength)
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/\\([)\\]])/g, '$1');
}
