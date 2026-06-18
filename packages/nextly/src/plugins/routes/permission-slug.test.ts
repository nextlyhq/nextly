import { describe, expect, it } from "vitest";

import { parsePermissionSlug } from "./permission-slug";

describe("parsePermissionSlug", () => {
  it("splits a slug into action and resource on the first hyphen", () => {
    expect(parsePermissionSlug("export-submissions")).toEqual({
      action: "export",
      resource: "submissions",
    });
    expect(parsePermissionSlug("read-posts")).toEqual({
      action: "read",
      resource: "posts",
    });
  });

  it("keeps later hyphens in the resource (action has no hyphen)", () => {
    expect(parsePermissionSlug("export-form-submissions")).toEqual({
      action: "export",
      resource: "form-submissions",
    });
  });

  it("treats a slug without a hyphen as an action with an empty resource", () => {
    expect(parsePermissionSlug("manage")).toEqual({
      action: "manage",
      resource: "",
    });
  });
});
