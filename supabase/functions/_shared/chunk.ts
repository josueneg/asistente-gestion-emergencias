// Divide un texto largo en fragmentos (chunks) con superposición,
// para indexarlos individualmente en la base vectorial.
export function chunkText(
  text: string,
  maxChars = 3000,
  overlap = 300,
): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + maxChars, cleaned.length);
    chunks.push(cleaned.slice(start, end));
    if (end === cleaned.length) break;
    start = end - overlap;
  }
  return chunks;
}
