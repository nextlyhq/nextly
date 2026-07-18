/**
 * Guards the auth tier of the dynamic dispatcher routes. The standalone
 * `nextly/api/components` route gates listing behind a permission check, so
 * the dispatcher path (which templates actually mount via
 * `createDynamicHandlers`) must not leave the same listing unauthenticated —
 * otherwise anonymous callers could still enumerate component schemas.
 */
import { describe, expect, it } from "vitest";

import { isPublicEndpoint, requiresAuthOnly } from "../route-parser";

describe("component route auth tier", () => {
  it("does not expose component listing or retrieval as public endpoints", () => {
    expect(isPublicEndpoint("components", "listComponents")).toBe(false);
    expect(isPublicEndpoint("components", "getComponent")).toBe(false);
  });

  it("requires authentication (no specific permission) to list components", () => {
    // Same class as listCollections/listSingles/getComponent: any signed-in
    // user may read builder-surface metadata; the palette needs it.
    expect(requiresAuthOnly("components", "listComponents")).toBe(true);
    expect(requiresAuthOnly("components", "getComponent")).toBe(true);
  });

  it("keeps genuinely public endpoints public", () => {
    // Regression guard: the change must not tighten unrelated public routes.
    expect(isPublicEndpoint("forms", "submit")).toBe(true);
    expect(isPublicEndpoint("auth", "register")).toBe(true);
  });
});
