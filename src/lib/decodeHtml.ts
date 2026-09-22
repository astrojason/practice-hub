/** The API returns some names (tunings, playlists) with HTML entities, e.g. "C&#35; Standard". */
export function decodeHtml(html: string): string {
  const ta = document.createElement("textarea");
  ta.innerHTML = html;
  return ta.value;
}
