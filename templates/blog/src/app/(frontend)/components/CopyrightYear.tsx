import { cachedFind } from "nextly/runtime";

/** A day, in seconds: how stale the year may be just after it changes. */
const ONE_DAY = 60 * 60 * 24;

/**
 * The current year, for the footer's copyright line.
 *
 * Read inside a cached scope rather than in the render: under Cache Components
 * a render that reads the clock outside one cannot be prerendered, and the
 * footer is on every page. `cachedFind` is the same cache every other read in
 * this template uses, so it works with Cache Components on or off.
 */
export async function CopyrightYear() {
  const year = await cachedFind(async () => new Date().getFullYear(), {
    tags: [],
    keyParts: ["blog-footer-year"],
    revalidate: ONE_DAY,
  });
  return <>{year}</>;
}
