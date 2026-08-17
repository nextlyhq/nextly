/**
 * Guards the auth tier of the dynamic dispatcher routes. The standalone
 * `nextly/api/field-groups` route gates listing behind a permission check, so
 * the dispatcher path (which templates actually mount via
 * `createDynamicHandlers`) must not leave the same listing unauthenticated —
 * otherwise anonymous callers could still enumerate component schemas.
 */
import { describe, expect, it } from "vitest";

import { isPublicEndpoint, requiresAuthOnly } from "../route-parser";

describe("component route auth tier", () => {
  it("does not expose component listing or retrieval as public endpoints", () => {
    expect(isPublicEndpoint("field-groups", "listComponents")).toBe(false);
    expect(isPublicEndpoint("field-groups", "getComponent")).toBe(false);
  });

  it("requires authentication (no specific permission) to list components", () => {
    // Same class as listCollections/listSingles/getComponent: any signed-in
    // user may read builder-surface metadata; the palette needs it.
    expect(requiresAuthOnly("field-groups", "listComponents")).toBe(true);
    expect(requiresAuthOnly("field-groups", "getComponent")).toBe(true);
  });

  it("keeps field-group mutations behind a permission check", () => {
    // Mutations must be neither public nor merely authenticated: they resolve
    // to the settings grants in `resolveAuthorization`, which keys on this same
    // service name. A rename that moves the parser but not that branch drops
    // these into the default `<action>-field-groups` grants, which are never
    // seeded — so every mutation 403s for users who should be allowed.
    for (const method of [
      "createComponent",
      "updateComponent",
      "deleteComponent",
      "previewComponentSchemaChanges",
      "applyComponentSchemaChanges",
      "reconcileComponent",
      // Writes nothing, and still belongs in this list: it reports live column shapes and the
      // drift against the stored definition, so it must be no more reachable than the repair it
      // describes. Its verb is GET, which is exactly why leaving it out would be easy.
      "previewComponentReconcile",
    ]) {
      expect(isPublicEndpoint("field-groups", method)).toBe(false);
      expect(requiresAuthOnly("field-groups", method)).toBe(false);
    }
  });

  it("keeps genuinely public endpoints public", () => {
    // Regression guard: the change must not tighten unrelated public routes.
    expect(isPublicEndpoint("forms", "submit")).toBe(true);
    expect(isPublicEndpoint("auth", "register")).toBe(true);
  });
});
