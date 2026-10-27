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
