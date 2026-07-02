/** Reject dangerous URL schemes for image/link/video srcs. Allows http(s)/relative/mailto/tel. */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const u = url.trim();
  if (!u) return undefined;
  if (/^(javascript|vbscript|data):/i.test(u)) return undefined;
  return u;
}
