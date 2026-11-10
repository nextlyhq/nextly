/**
 * No admin page hand-draws its own `h1`: page titles come from the shared
 * `PageHeader`, so a title, its summary and its actions look and read the same
 * everywhere, and a copied header cannot drift from the rest.
 *
 * This is a prohibition on raw `h1` markup, read from the source with comments
 * and string literals removed. It does not count the headings a rendered page
 * ends up with: a page that renders no header, or two, passes here, and the
 * count is not checked by this suite. The few places allowed their own `h1`
 * are listed below with the reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ADMIN_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Places that draw their own `h1`, and why that is right for them. */
const ALLOWED: Record<string, string> = {
  "components/features/releases/ReleasePageHeader.tsx":
    "a release's title is an editable document title, like an entry's",
  "components/features/versions/VersionComparePage.tsx":
    "a full-screen compare workspace with its own toolbar",
  "components/features/media-library/MediaLibraryToolbar/index.tsx":
    "the library's working toolbar, whose heading takes focus after navigation",
  "components/features/widgets/preview/WidgetPreviewsView.tsx":
    "a development-only preview page",
  "components/shared/error-fallbacks/PageErrorFallback.tsx":
    "a full-page error state, drawn when the page itself failed",
  "components/shared/maintenance-page/index.tsx":
    "a full-page maintenance state, outside the admin's page frame",
  "components/shared/status-page/index.tsx":
    "a full-page status state, outside the admin's page frame",
  "pages/index.tsx": "a placeholder no route renders",
  "pages/dashboard/index.tsx":
    "the dashboard's own error state; the dashboard draws its own header",
  "components/features/dashboard/WelcomeHeader.tsx":
    "the dashboard's greeting, which takes focus back when a card is removed",
  "components/features/entries/EntryForm/DocumentViewFieldChooser.tsx":
    "a document view's own state inside the entry editor",
  "components/features/entries/EntryForm/DocumentViewFieldRefused.tsx":
    "a document view's own state inside the entry editor",
};

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourcesUnder(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * The source with comments and quoted strings removed, so a heading named in
 * prose or in a placeholder string (`"<h1>Hello</h1>"`) is not read as one
 * drawn.
 */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const files = [
  ...sourcesUnder(join(ADMIN_SRC, "pages")),
  ...sourcesUnder(join(ADMIN_SRC, "components/features")),
  ...sourcesUnder(join(ADMIN_SRC, "components/shared")),
].map(path => ({
  path: relative(ADMIN_SRC, path),
  draws: /<h1[\s>]/.test(withoutComments(readFileSync(path, "utf8"))),
}));

describe("no hand-drawn page headings", () => {
  it("draws no h1 outside the shared page header, except where listed", () => {
    const hand = files
      .filter(f => f.draws && !(f.path in ALLOWED))
      .map(f => f.path);
    expect(hand, "use PageHeader for these pages' titles").toEqual([]);
  });

  it("keeps the list current: every listed place still draws its own h1", () => {
    const stale = Object.keys(ALLOWED).filter(
      path => !files.some(f => f.path === path && f.draws)
    );
    expect(stale, "remove these from the list").toEqual([]);
  });

  it("discriminates: the scan sees the h1s it allows", () => {
    // If this finds none, the scan has stopped reading the sources and both
    // assertions above pass on nothing.
    expect(files.filter(f => f.draws).length).toBeGreaterThan(0);
  });
});
