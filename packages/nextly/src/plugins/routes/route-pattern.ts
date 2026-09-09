/**
 * What the route matcher considers a match, in one place.
 *
 * Three things ask this question: the matcher itself, the collision check that
 * refuses two plugins one address, and the predicate that decides whether a
 * request could reach a plugin route at all. Answered separately they drift,
 * and the drift is silent in the worst direction: a collision check narrower
 * than the matcher lets two plugins register one URL and leaves the winner to
 * registration order.
 *
 * A segment is either a literal or a `:capture`, and a capture matches exactly
 * one segment. That is the whole grammar.
 *
 * @module plugins/routes/route-pattern
 */

export function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function isCapture(segment: string): boolean {
  return segment.startsWith(":");
}

/** How many segments are literal. The matcher's specificity, and its tie-break. */
export function literalCount(segments: readonly string[]): number {
  return segments.filter(seg => !isCapture(seg)).length;
}

/**
 * Whether some request path exists that BOTH patterns would match.
 *
 * Not string equality, and not "one contains a capture". Two patterns overlap
 * unless some position holds two DIFFERENT literals, because a capture accepts
 * whatever the other pattern requires there. `/x/:id/end` and `/x/fixed/:tail`
 * share `/x/fixed/end` while sharing neither text nor shape.
 */
export function patternsOverlap(
  a: readonly string[],
  b: readonly string[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => isCapture(seg) || isCapture(b[i]) || seg === b[i]);
}

/**
 * Whether a concrete path matches a pattern, capturing as it goes.
 *
 * `null` when it does not, so a caller cannot mistake an empty capture set for
 * a failed match.
 */
export function matchPattern(
  segments: readonly string[],
  pathSegments: readonly string[]
): Record<string, string> | null {
  if (segments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (isCapture(seg)) {
      params[seg.slice(1)] = pathSegments[i];
    } else if (seg !== pathSegments[i]) {
      return null;
    }
  }
  return params;
}
