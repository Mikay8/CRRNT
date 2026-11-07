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
 * the publisher - so a shared story brings the reader into CRRNT. */
export function crrntStoryUrl(storyId: string): string {
  return `https://www.crrnt-news.com/story/${storyId}`;
}

/** Share-sheet message: the headline, the CRRNT tagline, and the
 * CRRNT story link. */
export function storyShareMessage(title: string, storyId: string): string {
  return [title, "via CRRNT \u2014 Short headlines, zero noise", crrntStoryUrl(storyId)]
    .filter(Boolean)
    .join("\n");
}
