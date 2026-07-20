import { describe, it, expect } from "vitest";

import {
  resolveCollectionTableName,
  resolvePrefixedTableName,
} from "./resolve-table-name";

describe("resolvePrefixedTableName", () => {
  it("prefixes a dbName that lacks the target prefix", () => {
    expect(resolvePrefixedTableName("forms", "forms", "dc_")).toBe("dc_forms");
    expect(
      resolvePrefixedTableName("form-submissions", "form_submissions", "dc_")
    ).toBe("dc_form_submissions");
  });

  it("uses a dbName that already carries the target prefix verbatim", () => {
    expect(resolvePrefixedTableName("posts", "dc_posts", "dc_")).toBe(
      "dc_posts"
    );
  });

  it("falls back to the prefixed, underscored slug when no dbName is given", () => {
    expect(resolvePrefixedTableName("my-things", undefined, "dc_")).toBe(
      "dc_my_things"
    );
  });

  it("supports the single_ and comp_ prefixes", () => {
    expect(resolvePrefixedTableName("homepage", undefined, "single_")).toBe(
      "single_homepage"
    );
    expect(resolvePrefixedTableName("seo", "seo", "comp_")).toBe("comp_seo");
  });
});

describe("resolveCollectionTableName", () => {
  it("applies the dc_ prefix, matching the generic resolver", () => {
    expect(resolveCollectionTableName("posts")).toBe("dc_posts");
    expect(resolveCollectionTableName("forms", "forms")).toBe("dc_forms");
    expect(resolveCollectionTableName("posts", "dc_posts")).toBe("dc_posts");
  });
});
