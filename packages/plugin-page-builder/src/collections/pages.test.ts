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

import { PAGE_BUILDER_CUSTOM_CSS_FIELD, pagesCollection } from "./pages";

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

/**
 * How an entry is edited is decided by the FIELD, not per entry.
 *
 * Asserted on the collection rather than through the admin, because what this
 * guards is structural: the retired switch stored a UI preference as a column
 * and left a second content field beside it. Both are visible here, and neither
 * is something an admin-rendering test would have reported.
 */
describe("pages is built from blocks", () => {
  const fieldsOf = () =>
    pagesCollection().fields as { name?: string; type?: string }[];

  it("carries a blocks field for the page body", () => {
    // The positive control for the two absences below: each of them is
    // satisfied by a collection with no fields at all, and this is the
    // assertion that separates those cases.
    const content = fieldsOf().find(f => f.name === "content");
    expect(content?.type).toBe("blocks");
  });

  it("stores no editor-mode preference", () => {
    // `editorMode` was a real column, so it travelled in API responses and
    // exports and could be written by anything holding the entry.
    expect(fieldsOf().map(f => f.name)).not.toContain("editorMode");
  });

  it("offers no second content field to diverge from the blocks one", () => {
    // Both arms of the retired choice persisted at once — what hid one was
    // `admin.condition`, which reaches the admin form and nothing else — so an
    // entry could hold a block document AND rich text with one of them unread.
    expect(fieldsOf().map(f => f.name)).not.toContain("body");
  });
});
