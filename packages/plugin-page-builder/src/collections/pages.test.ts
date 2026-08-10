/**
 * The `pages` collection gates custom CSS on a permission.
 *
 * The rule and the declared permission are two halves of one thing: a rule
 * reading a string nothing seeds denies forever, and a permission nothing reads
 * grants nothing. Both are asserted here against the SAME exported constants,
 * so the pair cannot drift.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import {
  CUSTOM_CSS_ACTION,
  CUSTOM_CSS_GRANT,
  CUSTOM_CSS_RESOURCE,
} from "../permissions";

import { PAGE_BUILDER_CUSTOM_CSS_FIELD } from "./pageBuilderEntry";
import { pagesCollection } from "./pages";

type AccessArgs = { permissions: string[] };
type FieldWithAccess = {
  name?: string;
  access?: {
    create?: (a: AccessArgs) => boolean;
    read?: unknown;
    update?: (a: AccessArgs) => boolean;
  };
};

const cssField = (): FieldWithAccess => {
  const field = (pagesCollection().fields as FieldWithAccess[]).find(
    f => f.name === PAGE_BUILDER_CUSTOM_CSS_FIELD
  );
  if (!field) throw new Error("customCss field missing from pages");
  return field;
};

describe("pages custom CSS permission", () => {
  it("allows the write only with the grant", () => {
    const { access } = cssField();
    expect(access?.update?.({ permissions: [CUSTOM_CSS_GRANT] })).toBe(true);
    expect(access?.create?.({ permissions: [CUSTOM_CSS_GRANT] })).toBe(true);
    expect(access?.update?.({ permissions: [] })).toBe(false);
    // A near miss must not pass: `pages:update` lets someone edit the page and
    // is exactly what a user without this privilege already holds.
    expect(access?.update?.({ permissions: ["pages:update"] })).toBe(false);
  });

  it("does not gate reading it", () => {
    // Withholding the grant makes the field read-only, not invisible. Hiding
    // it would show an empty editor over stored CSS and invite overwriting it.
    expect(cssField().access?.read).toBeUndefined();
  });

  it("declares the permission the rule reads", () => {
    const declared = pageBuilder().contributes?.permissions ?? [];
    const match = declared.find(
      p => p.action === CUSTOM_CSS_ACTION && p.resource === CUSTOM_CSS_RESOURCE
    );
    expect(match).toBeDefined();
    // Author-written CSS reaching the published page is worth a warning.
    expect(match?.danger).toBe(true);
  });

  it("spells the grant the way an access rule receives it", () => {
    // The database and the admin matrix use `action-resource` for this same
    // row. A rule written with that spelling matches nothing and denies
    // silently, which is the whole reason the constant exists.
    expect(CUSTOM_CSS_GRANT).toBe(
      `${CUSTOM_CSS_RESOURCE}:${CUSTOM_CSS_ACTION}`
    );
    expect(CUSTOM_CSS_GRANT).not.toBe(
      `${CUSTOM_CSS_ACTION}-${CUSTOM_CSS_RESOURCE}`
    );
  });
});
