import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    post: vi.fn(async () => ({ message: "ok", kind: "x" })),
    delete: vi.fn(async () => ({ message: "ok", kind: "x" })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { schemaFileApi } from "../schemaFileApi";

const entity = {
  slug: "hero",
  fields: [{ name: "title", type: "text" as const }],
};

describe("schemaFileApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writeSingle posts to /_dev/schema/single", async () => {
    await schemaFileApi.writeSingle(entity);
    expect(protectedApi.post).toHaveBeenCalledWith(
      "/_dev/schema/single",
      entity
    );
  });

  it("writeFieldGroup posts to /_dev/schema/field-group", async () => {
    await schemaFileApi.writeFieldGroup(entity);
    expect(protectedApi.post).toHaveBeenCalledWith(
      "/_dev/schema/field-group",
      entity
    );
  });

  it("deleteCollection deletes /_dev/schema/collection/<slug>", async () => {
    await schemaFileApi.deleteCollection("posts");
    expect(protectedApi.delete).toHaveBeenCalledWith(
      "/_dev/schema/collection/posts"
    );
  });

  it("deleteSingle / deleteFieldGroup target the right path", async () => {
    await schemaFileApi.deleteSingle("hero");
    expect(protectedApi.delete).toHaveBeenCalledWith(
      "/_dev/schema/single/hero"
    );
    await schemaFileApi.deleteFieldGroup("card");
    expect(protectedApi.delete).toHaveBeenCalledWith(
      "/_dev/schema/field-group/card"
    );
  });
});
