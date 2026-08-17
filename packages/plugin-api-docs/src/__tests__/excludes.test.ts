/**
 * Tests for the typed spec excludes.
 *
 * @module __tests__/excludes
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import { applyExcludes, excludeOperationsByService } from "../excludes";
import type { DocsOperation } from "../descriptors";
import { generateOpenApiDocument } from "../generate";
import type { ScanResult } from "../scan";

const scan = (): ScanResult => ({
  routes: [
    {
      mountPath: "/admin/api/[[...params]]",
      source: { kind: "dynamic-catchall" },
      verbs: ["GET"],
    },
  ],
  unrecognized: [],
});

const ops: readonly DocsOperation[] = [
  {
    service: "users",
    operation: "listUsers",
    method: "GET",
    path: "/users",
    auth: "permission",
    permissionSlug: "read-users",
    tag: "Users",
  },
  {
    service: "users",
    operation: "getCurrentUser",
    method: "GET",
    path: "/me",
    auth: "authenticated",
    tag: "Users",
  },
];

describe("excludeOperationsByService", () => {
  it("drops a named service's operations", () => {
    const kept = excludeOperationsByService(ops, ["users"]);
    expect(kept).toHaveLength(0);
  });

  it("keeps everything when no services are named", () => {
    expect(excludeOperationsByService(ops, undefined)).toHaveLength(2);
    expect(excludeOperationsByService(ops, [])).toHaveLength(2);
  });
});

describe("applyExcludes", () => {
  const baseDoc = () =>
    generateOpenApiDocument({ scan: scan(), restOperations: ops });

  it("drops paths matching an excludePaths glob", () => {
    const doc = applyExcludes(baseDoc(), { excludePaths: ["**/me"] });
    const paths = Object.keys((doc.paths ?? {}) as Record<string, unknown>);
    expect(paths.some(p => p.endsWith("/me"))).toBe(false);
    expect(paths.some(p => p.includes("/users"))).toBe(true);
  });

  it("drops error codes named in excludeErrorCodes from the enum", () => {
    const doc = applyExcludes(baseDoc(), {
      excludeErrorCodes: ["NOT_FOUND", "FORBIDDEN"],
    });
    const components = doc.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const errorResponse = schemas.ErrorResponse as Record<string, unknown>;
    const error = (errorResponse.properties as Record<string, unknown>)
      .error as Record<string, unknown>;
    const codeProp = (error.properties as Record<string, unknown>).code as {
      enum: string[];
    };
    expect(codeProp.enum).not.toContain("NOT_FOUND");
    expect(codeProp.enum).not.toContain("FORBIDDEN");
    // Other codes survive.
    expect(codeProp.enum).toContain("VALIDATION_ERROR");
  });

  it("returns the document untouched when no excludes are set", () => {
    const doc = baseDoc();
    expect(applyExcludes(doc, {})).toBe(doc);
  });
});
