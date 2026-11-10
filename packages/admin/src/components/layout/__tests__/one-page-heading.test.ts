/**
 * Every page's `h1` comes from the shared page header, so a page's title,
 * summary and actions look and read the same everywhere, and each page has
 * exactly one top-level heading. A page that hand-draws its own `h1` drifts
 * from the rest the day its markup is copied.
 *
 * The scan reads the admin's pages and feature components, with comments
 * removed, for a literal `<h1`. The few places allowed one are listed below
 * with the reason; anything else is a page that should use `PageHeader`.
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

describe("one page heading", () => {
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
