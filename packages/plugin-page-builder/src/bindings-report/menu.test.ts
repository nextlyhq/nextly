/**
 * The "Bindings to fix" page is reached from the Page Builder's menu, and the
 * entry asks what the page asks: one address and one permission, so the menu
 * never offers the page to someone it would refuse.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import {
  BINDINGS_TO_FIX_PAGE_HREF,
  BINDINGS_TO_FIX_ROUTE_PATH,
} from "./contract";

describe("the Bindings to fix menu entry", () => {
  it("links to the page and asks the page's own permission", () => {
    const admin = pageBuilder().contributes?.admin;
    const entry = (admin?.menu ?? []).find(
      item => item.label === "Bindings to fix"
    );
    const page = (admin?.pages ?? []).find(
      candidate => candidate.path === BINDINGS_TO_FIX_ROUTE_PATH
    );
    expect(entry?.to).toBe(BINDINGS_TO_FIX_PAGE_HREF);
    expect(page).toBeDefined();
    expect(entry?.requiredPermission).toBe(page?.requiredPermission);
    // The control: the page is gated, so an entry agreeing with it is too.
    expect(page?.requiredPermission).toBe("update-pages");
  });
});
