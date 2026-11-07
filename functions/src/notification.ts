const previewLimit = 120;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** A single-line excerpt, never the full note or its member metadata. */
export function reminderPreview(body: unknown): string {
  if (typeof body !== 'string') return '';
  const text = body.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(
    graphemes.segment(text),
    (part) => part.segment,
  );
  return characters.length <= previewLimit
    ? text
    : characters
        .slice(0, previewLimit - 1)
        .join('')
        .trimEnd() + '…';
}
