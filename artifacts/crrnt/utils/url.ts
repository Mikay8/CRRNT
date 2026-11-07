/** Extract a display-friendly domain from a URL */
export function sourceDomain(url?: string | null): string {
  if (!url) return "CRRNT";
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch {
    return "CRRNT";
  }
}

/** Canonical CRRNT web URL for a story. Shares point here - never at
 * the publisher - so a shared story brings the reader into CRRNT.
 * Prefers the story's short readable slug; the UUID works too (the
 * backend resolves both), so stories without a slug yet still link. */
export function crrntStoryUrl(storyId: string, slug?: string | null): string {
  return `https://www.crrnt-news.com/story/${slug || storyId}`;
}

/** Share-sheet message: the headline, the CRRNT tagline, and the
 * CRRNT story link. */
export function storyShareMessage(
  title: string,
  storyId: string,
  slug?: string | null
): string {
  return [title, "via CRRNT \u2014 Short headlines, zero noise", crrntStoryUrl(storyId, slug)]
    .filter(Boolean)
    .join("\n");
}
