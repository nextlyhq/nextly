/**
 * Tests for the OpenAPI document generator.
 *
 * Feeds a synthetic scan + operations shaped like the core seam's output, so the
 * assembly is exercised end-to-end without booting the app. The headline
 * invariant is the "generated from the enum" rule: every live
 * `NEXTLY_ERROR_STATUS` code must appear in the spec's `ErrorResponse.code`
 * enum — asserted against the live enum, never a hardcoded count.
 *
 * @module __tests__/generate
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "@nextlyhq/plugin-sdk";

import type { DocsOperation } from "../descriptors";
import { generateOpenApiDocument } from "../generate";
import type { ScanResult } from "../scan";

const scan = (): ScanResult => ({
  routes: [
    {
      mountPath: "/admin/api/[[...params]]",
      source: { kind: "dynamic-catchall" },
      verbs: ["GET", "POST", "PATCH", "DELETE"],
    },
  ],
  unrecognized: [],
});

// Synthetic admin REST operations, shaped exactly like the core seam's output.
const restOps: readonly DocsOperation[] = [
  {
    service: "users",
    operation: "getCurrentUser",
    method: "GET",
    path: "/me",
    auth: "authenticated",
    tag: "Users",
  },
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
    operation: "createLocalUser",
    method: "POST",
    path: "/users",
    auth: "permission",
    permissionSlug: "create-users",
    tag: "Users",
  },
  {
    service: "users",
    operation: "getUserById",
    method: "GET",
    path: "/users/{userId}",
    auth: "permission",
    permissionSlug: "read-users",
    tag: "Users",
  },
  {
    service: "users",
    operation: "updateUser",
    method: "PATCH",
    path: "/users/{userId}",
    auth: "permission",
    permissionSlug: "update-users",
    tag: "Users",
  },
  {
    service: "users",
    operation: "deleteUser",
    method: "DELETE",
    path: "/users/{userId}",
    auth: "permission",
    permissionSlug: "delete-users",
    tag: "Users",
  },
];

const doc = (): Record<string, unknown> =>
  generateOpenApiDocument({ scan: scan(), restOperations: restOps });

describe("generateOpenApiDocument — structure", () => {
  it("produces an OpenAPI 3.1.0 document with info and components", () => {
    const d = doc();
    expect(d.openapi).toBe("3.1.0");
    expect(d.info).toEqual({ title: "Nextly API", version: "0.0.0" });
    expect(d.components).toBeDefined();
  });

  it("joins operations with the scanned mount base", () => {
    const paths = (doc().paths ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(paths["/admin/api/users"]?.get).toBeDefined();
    expect(paths["/admin/api/users"]?.post).toBeDefined();
    expect(paths["/admin/api/users/{userId}"]?.get).toBeDefined();
    expect(paths["/admin/api/users/{userId}"]?.patch).toBeDefined();
    expect(paths["/admin/api/users/{userId}"]?.delete).toBeDefined();
    expect(paths["/admin/api/me"]?.get).toBeDefined();
  });

  it("attaches cookie + bearer security to a permission-gated operation", () => {
    const paths = (doc().paths ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const get = paths["/admin/api/users"]?.get as
      Record<string, unknown> | undefined;
    expect(get?.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }]);
    expect(get?.["x-nextly-permission"]).toBe("read-users");
  });
});

describe("generateOpenApiDocument — errors generated from the live enum", () => {
  it("lists EVERY live error code in ErrorResponse.code (no hardcoded list)", () => {
    const components = doc().components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const errorResponse = schemas.ErrorResponse as Record<string, unknown>;
    const error = (errorResponse.properties as Record<string, unknown>)
      .error as Record<string, unknown>;
    const codeProp = (error.properties as Record<string, unknown>).code as {
      enum: string[];
    };

    const liveCodes = Object.keys(NEXTLY_ERROR_STATUS);
    expect(codeProp.enum.sort()).toEqual([...liveCodes].sort());
  });

  it("emits one response entry per HTTP status the enum defines", () => {
    const components = doc().components as Record<string, unknown>;
    const responses = components.responses as Record<string, unknown>;
    for (const status of new Set(Object.values(NEXTLY_ERROR_STATUS))) {
      expect(responses[String(status)]).toBeDefined();
    }
  });

  it("documents x-request-id on every response and retry-after on 429 only", () => {
    const components = doc().components as Record<string, unknown>;
    const responses = components.responses as Record<
      string,
      Record<string, unknown>
    >;
    for (const entry of Object.values(responses)) {
      const headers = entry.headers as Record<string, unknown> | undefined;
      expect(headers?.["x-request-id"]).toBeDefined();
    }
    expect(
      (responses["429"]?.headers as Record<string, unknown>)?.["retry-after"]
    ).toBeDefined();
    expect(
      (responses["400"]?.headers as Record<string, unknown>)?.["retry-after"]
    ).toBeUndefined();
  });
});

describe("generateOpenApiDocument — security schemes", () => {
  it("declares cookieAuth and bearerAuth", () => {
    const components = doc().components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<string, unknown>;
    expect((schemes.cookieAuth as Record<string, unknown>).type).toBe("apiKey");
    expect((schemes.bearerAuth as Record<string, unknown>).scheme).toBe(
      "bearer"
    );
  });
});
