/**
 * The theme lab's switcher must stay OUTSIDE the admin root.
 *
 * The panel is styled with fixed colours rather than `--nx-*` tokens, which
 * would be a violation of the admin's token-driven styling contract if it were
 * part of the admin's styling surface. It is not: it renders as a sibling of
 * the admin subtree, so `.nextly-admin`'s rules never reach it.
 *
 * That distinction currently rests on where one JSX element sits. Move it
 * inside and three things break at once and quietly: the admin's base rule
 * (`.nextly-admin * { border-color: var(--nx-border) }`) starts repainting the
 * panel's edges, the panel becomes subject to a contract it deliberately opts
 * out of, and the control whose job is to show what a theme change did becomes
 * the first thing that theme change makes unreadable.
 *
 * A comment saying "this is a deliberate exception" does not survive a
 * refactor. This does.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const layoutPath = resolve(here, "../../app/admin/[[...params]]/layout.tsx");
const layout = readFileSync(layoutPath, "utf8");

describe("the theme lab switcher stays outside the admin root", () => {
  it("reads the admin layout", () => {
    // Every assertion below is vacuously true over an empty read.
    expect(layout.length).toBeGreaterThan(0);
    expect(layout).toContain("ThemeSwitcher");
  });

  it("renders the switcher as a sibling of the admin subtree", () => {
    // `{children}` is where the admin -- and therefore `.nextly-admin` --
    // renders. The switcher must come after it at the same depth, not within
    // any element the admin owns.
    const childrenAt = layout.indexOf("{children}");
    const switcherAt = layout.indexOf("<ThemeSwitcher");
    expect(childrenAt).toBeGreaterThan(-1);
    expect(switcherAt).toBeGreaterThan(childrenAt);

    // Nothing opens between them: a wrapper introduced there could be an admin
    // container, which is exactly the move this guards against.
    const between = layout.slice(childrenAt + "{children}".length, switcherAt);
    expect(
      between.includes("<"),
      `Something is rendered between {children} and <ThemeSwitcher /> in ` +
        `${layoutPath}. The switcher is styled with fixed colours because it ` +
        `sits outside the admin's styling surface; wrapping it in anything ` +
        `the admin owns makes that an unmarked violation of the token rule.`
    ).toBe(false);
  });

  it("does not paint its own chrome from admin tokens", () => {
    // The panel pins a few `--nx-*` values for the preview CARDS it contains,
    // which wear `nextly-admin` on purpose. Its own surfaces must not READ
    // them, or the panel inherits whatever theme it is being used to judge.
    const switcher = readFileSync(
      resolve(here, "../ThemeSwitcher.tsx"),
      "utf8"
    );
    const reads = [...switcher.matchAll(/var\(\s*(--nx-[a-z0-9-]+)/g)].map(
      match => match[1]
    );
    expect(
      reads,
      `The switcher reads admin tokens for its own chrome, so it will change ` +
        `appearance with the theme it exists to evaluate:\n${reads.join("\n")}`
    ).toEqual([]);
  });
});
