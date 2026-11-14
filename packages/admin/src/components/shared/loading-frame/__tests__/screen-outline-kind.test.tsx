/**
 * Which outline an address draws, held to the route table: an address is
 * outlined as an editor (and folded as one) exactly when the router opens it
 * in the editor's page, so a page beside the editor, such as an entry's
 * history, never draws the editor's frame.
 *
 * @module components/shared/loading-frame/__tests__/screen-outline-kind.test
 */
import { describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";
import { ROUTES } from "@admin/constants/routes";
import { routePatternRegex } from "@admin/lib/route-pattern";
import { routeConfig } from "@admin/pages/registry";

const folding = vi.hoisted(() => ({ asked: vi.fn() }));
// Which collection the outline asks to fold the panel for, watched.
vi.mock("@admin/components/layout/PanelFold", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/components/layout/PanelFold")
  >()),
  useCollectionFoldedPanel: (slug: string | undefined) => folding.asked(slug),
}));

import { ScreenOutlineFor, screenOutlineKind } from "../screen-outline-for";

/** The page each editor kind is drawn by, as the route table names it. */
const EDITOR_PAGES = new Map([
  [routeConfig[ROUTES.COLLECTION_ENTRY_EDIT].component, "entry-editor"],
  [routeConfig[ROUTES.COLLECTION_ENTRY_CREATE].component, "entry-creator"],
  [routeConfig[ROUTES.SINGLE_EDIT].component, "single-editor"],
]);

const SAMPLE_PARAMS: Record<string, string> = {
  slug: "forms",
  id: "e1",
  view: "preview",
};

/** An address the pattern opens, with each parameter filled in. */
function addressOf(pattern: string): string {
  return pattern.replace(/\[(\w+)\]/g, (_, key: string) => SAMPLE_PARAMS[key]);
}

/** The route the router opens `address` with: the first pattern that matches. */
function routedPattern(address: string): string | undefined {
  return Object.keys(routeConfig).find(pattern =>
    routePatternRegex(pattern).regex.test(address)
  );
}

const CONTENT_PATTERNS = Object.keys(routeConfig).filter(
  pattern =>
    pattern.startsWith(`${ROUTES.COLLECTIONS}/`) ||
    pattern.startsWith(`${ROUTES.SINGLES}/`)
);

describe("the outline an address draws, held to the route table", () => {
  it("has collection and Single routes to check", () => {
    expect(CONTENT_PATTERNS).toContain(ROUTES.COLLECTION_ENTRY_VERSIONS);
    expect(CONTENT_PATTERNS).toContain(ROUTES.SINGLE_VERSIONS);
  });

  it.each(CONTENT_PATTERNS)(
    "outlines %s as the editor only when the router opens the editor",
    pattern => {
      const address = addressOf(pattern);
      const routed = routedPattern(address);
      expect(routed).toBe(pattern);
      const editor = EDITOR_PAGES.get(routeConfig[pattern].component);
      const kind = screenOutlineKind(address);
      if (editor === undefined) {
        expect(kind).not.toMatch(/editor|creator/);
      } else {
        expect(kind).toBe(editor);
      }
    }
  );

  it("outlines an entry's history as the history page, not the editor", () => {
    expect(screenOutlineKind("/admin/collections/forms/e1/versions")).toBe(
      "history"
    );
    expect(screenOutlineKind("/admin/collections/forms/e1/versions/")).toBe(
      "history"
    );
    expect(screenOutlineKind("/admin/singles/homepage/versions")).toBe(
      "history"
    );
    expect(screenOutlineKind("/admin/collections/forms/e1")).toBe(
      "entry-editor"
    );
  });

  it("outlines an address no route opens as a plain page", () => {
    expect(
      screenOutlineKind("/admin/collections/forms/e1/versions/extra")
    ).toBe("generic");
  });
});

describe("the panel fold an address's outline asks for", () => {
  it("does not fold the panel for a folding collection's history", () => {
    render(
      <ScreenOutlineFor pathname="/admin/collections/forms/e1/versions" />
    );
    expect(folding.asked).toHaveBeenCalled();
    expect(folding.asked).not.toHaveBeenCalledWith("forms");
  });

  it("folds it for the same collection's editor", () => {
    render(<ScreenOutlineFor pathname="/admin/collections/forms/e1" />);
    expect(folding.asked).toHaveBeenCalledWith("forms");
  });
});
