import { describe, it, expect } from "vitest";

import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "./resolve-table-name";

// These resolvers exist so `migrate:create`/`migrate:check` name tables exactly
// as the running app does. The two kinds deliberately disagree, because their
// runtime counterparts do:
//
//   - Collections dash-replace the SLUG only and always carry a `dc_` prefix.
//     A custom `dbName` is used as written, so the CLI cannot "tidy" a dashed
//     one into a name the app never creates.
//   - Components run the stronger `normalizeIdentifier` on the slug, but honor
//     a custom `dbName` verbatim and unprefixed.
//
// Each expectation below therefore pins a runtime behaviour, not a preference;
// changing one means the generated migration targets the wrong table.
describe("resolveCollectionTableName", () => {
  it("prefixes a dbName that lacks the dc_ prefix (plugin collections)", () => {
    expect(resolveCollectionTableName("forms", "forms")).toBe("dc_forms");
    expect(
      resolveCollectionTableName("form-submissions", "form_submissions")
    ).toBe("dc_form_submissions");
  });

  it("uses a dbName already carrying the dc_ prefix verbatim", () => {
    expect(resolveCollectionTableName("posts", "dc_posts")).toBe("dc_posts");
  });

  it("falls back to the dashed slug when no dbName is given", () => {
    expect(resolveCollectionTableName("my-things")).toBe("dc_my_things");
  });

  // The runtime prefixes a custom dbName without rewriting it, so a dashed one
  // must survive intact — normalizing it here would point generated migrations
  // at a table the app never creates.
  it("keeps a custom dbName as written, dashes included", () => {
    expect(resolveCollectionTableName("posts", "my-table")).toBe("dc_my-table");
  });
});

describe("resolveComponentTableName", () => {
  // Mirrors the runtime (di/register.ts): components honor a custom dbName raw.
  it("honors a custom dbName verbatim, without forcing the comp_ prefix", () => {
    expect(resolveComponentTableName("hero", "component_hero")).toBe(
      "component_hero"
    );
  });

  it("prefixes and normalizes the slug when no dbName is given", () => {
    expect(resolveComponentTableName("hero")).toBe("comp_hero");
    expect(resolveComponentTableName("my-hero")).toBe("comp_my_hero");
  });

  it("applies the runtime normalizer (lowercase, collapse, trim) to the slug", () => {
    expect(resolveComponentTableName("My Hero!")).toBe("comp_my_hero");
    expect(resolveComponentTableName("--Weird__Name--")).toBe(
      "comp_weird_name"
    );
  });
});
