import { describe, expect, it } from "vitest";

import * as config from "../config";
import * as database from "../database";
import * as fieldCatalog from "../collections/fields/catalog";
import * as fieldGroupType from "../field-group-type";
import * as root from "../index";
import * as schemas from "../schemas";

// The rename is only complete when the old vocabulary is absent from every
// published entry point. A re-exported legacy name is indistinguishable from a
// supported one to anyone reading the package, so the list is spelled out here
// rather than derived: a name that comes back fails this test instead of
// shipping.
const FORBIDDEN = [
  "defineComponent",
  "component",
  "ComponentConfig",
  "ComponentLabel",
  "ComponentAdminOptions",
  "ComponentFieldConfig",
  "isComponentField",
  "validateComponentConfig",
  "assertValidComponentConfig",
  "RESERVED_COMPONENT_SLUGS",
  "MAX_COMPONENT_NESTING_DEPTH",
  "DesiredComponent",
  "dynamicComponents",
  "dynamicComponentsPg",
  "dynamicComponentsMysql",
  "dynamicComponentsSqlite",
  "DynamicComponentRecord",
  "DynamicComponentInsert",
  "ComponentSource",
  "ComponentMigrationStatus",
  "COMPONENT_SOURCE_TYPES",
  "COMPONENT_MIGRATION_STATUSES",
];

const ENTRY_POINTS: Array<[string, Record<string, unknown>]> = [
  ["nextly", root as Record<string, unknown>],
  ["nextly/config", config as Record<string, unknown>],
  ["nextly/schemas", schemas as Record<string, unknown>],
  ["nextly/database", database as Record<string, unknown>],
  ["nextly/field-catalog", fieldCatalog as Record<string, unknown>],
  ["nextly/field-group-type", fieldGroupType as Record<string, unknown>],
];

// 🔴 Pinned alongside the generated cases. `it.each` derives one case per entry, so REMOVING an
// entry deletes its own case and the suite shrinks by one while every remaining case passes — a
// vanished test reads exactly like a passing one. This asserts the matrix itself.
const PUBLISHED_ENTRY_POINT_COUNT = 6;

describe("published export surface", () => {
  it("checks every published entry point", () => {
    expect(ENTRY_POINTS).toHaveLength(PUBLISHED_ENTRY_POINT_COUNT);
  });

  it.each(ENTRY_POINTS)(
    "%s exposes no legacy component names",
    (_name, mod) => {
      const leaked = FORBIDDEN.filter(name => name in mod);
      expect(leaked).toEqual([]);
    }
  );

  it("exposes the field-group vocabulary from the config entry point", () => {
    // The counterpart to the list above: absence alone would also be satisfied
    // by deleting the API, so the replacements are asserted present.
    const cfg = config as Record<string, unknown>;
    expect(typeof cfg.defineFieldGroup).toBe("function");
    expect(typeof cfg.fieldGroup).toBe("function");
  });
});
