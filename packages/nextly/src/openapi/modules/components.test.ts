import { describe, expect, it } from "vitest";

import { componentsModule } from "./components";

describe("componentsModule", () => {
  it("is named 'components'", () => {
    expect(componentsModule.name).toBe("components");
  });

  it("declares all 7 component operations", () => {
    const summary = componentsModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/components/{slug}",
      "GET /api/components",
      "GET /api/components/{slug}",
      "PATCH /api/components/{slug}",
      "POST /api/components",
      "POST /api/components/schema/{slug}/apply",
      "POST /api/components/schema/{slug}/preview",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of componentsModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("preview / apply require a fields[] body", () => {
    const preview = componentsModule.operations.find(
      o => o.path === "/api/components/schema/{slug}/preview"
    )!;
    const apply = componentsModule.operations.find(
      o => o.path === "/api/components/schema/{slug}/apply"
    )!;
    expect(preview.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/SchemaPreviewRequest",
    });
    expect(apply.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/SchemaApplyRequest",
    });
  });

  it("registers the documented schemas", () => {
    const names = Object.keys(componentsModule.schemas ?? {}).sort();
    expect(names).toEqual([
      "Component",
      "CreateComponentRequest",
      "DeleteComponentResponse",
      "ListComponentsResponse",
      "MutationResponseComponent",
      "SchemaApplyRequest",
      "SchemaApplyResponse",
      "SchemaChangePreview",
      "SchemaPreviewRequest",
      "UpdateComponentRequest",
    ]);
  });
});
