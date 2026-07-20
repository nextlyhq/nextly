import { describe, it, expect } from "vitest";

import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "./resolve-table-name";

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
