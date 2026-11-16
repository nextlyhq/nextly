/**
 * A browser's User-Agent as a person reads it: "Safari 18 on macOS". Only
 * the common browsers and systems are named; anything else reads as the
 * browser or system it could tell, or "Unknown browser".
 *
 * @module admin/components/submissions/browser-label
 */

const BROWSERS: ReadonlyArray<[name: string, pattern: RegExp]> = [
  // Order matters: each of these also says "Chrome" or "Safari".
  ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
  ["Opera", /OPR\/(\d+)/],
  ["Samsung Internet", /SamsungBrowser\/(\d+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /Version\/(\d+)(?:\.\d+)*(?: Mobile\/\S+)? Safari\//],
];

const SYSTEMS: ReadonlyArray<[name: string, pattern: RegExp]> = [
  ["iOS", /iPhone|iPad|iPod/],
  ["Android", /Android/],
  ["Windows", /Windows/],
  ["macOS", /Mac OS X|Macintosh/],
  ["ChromeOS", /CrOS/],
  ["Linux", /Linux/],
];

export function browserLabel(userAgent: string): string {
  const browser = BROWSERS.find(([, pattern]) => pattern.test(userAgent));
  const system = SYSTEMS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  const named = browser
    ? `${browser[0]} ${userAgent.match(browser[1])?.[1] ?? ""}`.trim()
    : undefined;
  if (named && system) return `${named} on ${system}`;
  return named ?? (system ? `A browser on ${system}` : "Unknown browser");
}
