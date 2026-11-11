/**
 * The rules the SEO settings' structured values are saved under, shared by
 * the Single that refuses a bad value and the screen that explains it as a
 * person types. Each answers why a value is wrong, in one sentence, or null.
 *
 * @module settings/stored-values
 */

/** Why a stored set of patterns is not one; null when it is. */
export function patternsProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return "Title patterns must be kept by content type.";
  }
  for (const [type, patterns] of Object.entries(value)) {
    if (
      typeof patterns !== "object" ||
      patterns === null ||
      Array.isArray(patterns)
    ) {
      return `The patterns for ${type} must be a title and a description.`;
    }
    for (const [part, pattern] of Object.entries(patterns)) {
      if (part !== "title" && part !== "description") {
        return `${type} has a pattern for ${part}; only a title and a description have one.`;
      }
      if (typeof pattern !== "string") {
        return `The ${part} pattern for ${type} must be text.`;
      }
    }
  }
  return null;
}

/** Why `url` is not the whole address of a profile; null when it is. */
export function profileAddressProblem(url: string): string | null {
  return /^https:\/\/[^\s/]+\.\S+$/i.test(url)
    ? null
    : "write the whole address of the profile, starting with https://.";
}

/** Why a stored list of social profiles is not one; null when it is. */
export function socialProfilesProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return "Social profiles must be a list.";
  for (const profile of value) {
    if (typeof profile !== "object" || profile === null) {
      return "Each social profile must have a network and an address.";
    }
    const { network, url } = profile as { network?: unknown; url?: unknown };
    if (typeof network !== "string" || typeof url !== "string") {
      return "Each social profile must have a network and an address.";
    }
    const problem = profileAddressProblem(url);
    if (problem !== null) {
      return `${url === "" ? "A profile" : url}: ${problem}`;
    }
  }
  return null;
}
