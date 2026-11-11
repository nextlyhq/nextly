/**
 * The "Suggested" To address for an address not found: the live page whose
 * address is closest to it, by the folders they share and the words their
 * last parts share, a nearer parent winning a tie.
 *
 * @module not-found/suggest
 */

/** The words of one address part: `keyword-research_tool.xml` → keyword, research, tool, xml. */
function words(part: string): Set<string> {
  return new Set(
    part
      .toLowerCase()
      .split(/[-_.~+]+/)
      .filter(word => word !== "")
  );
}

function partsOf(path: string): string[] {
  return path.split("/").filter(part => part !== "");
}

/** How alike two address parts are by their words, 0 to 1. */
function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** How close `candidate` is to `asked`: folders shared, then words shared. */
function closeness(asked: string[], candidate: string[]): number {
  let folders = 0;
  while (
    folders < Math.min(asked.length - 1, candidate.length) &&
    asked[folders] === candidate[folders]
  ) {
    folders += 1;
  }
  const askedLast = asked[asked.length - 1] ?? "";
  const candidateLast = candidate[candidate.length - 1] ?? "";
  return folders + 3 * overlap(askedLast, candidateLast);
}

/**
 * The closest of `live` addresses to `asked`, or null where none shares a
 * folder or a word with it.
 */
export function closestPage(
  asked: string,
  live: readonly string[]
): string | null {
  const askedParts = partsOf(asked);
  let best: { path: string; score: number; depth: number } | null = null;
  for (const path of live) {
    if (path === asked) continue;
    const parts = partsOf(path);
    const score = closeness(askedParts, parts);
    if (score <= 0) continue;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && parts.length < best.depth)
    ) {
      best = { path, score, depth: parts.length };
    }
  }
  return best?.path ?? null;
}
