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
    {
      mountPath: "/admin/api/media/[[...path]]",
      source: { kind: "media" },
      verbs: ["GET", "POST", "PATCH", "DELETE"],
    },
    {
      mountPath: "/api/media/[[...path]]",
      source: { kind: "media" },
      verbs: ["GET"],
    },
    {
      mountPath: "/api/health",
      source: { kind: "api-subpath", subpath: "health" },
      verbs: ["GET", "HEAD"],
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

describe("generateOpenApiDocument — public mounted surfaces (media + health)", () => {
  it("documents the admin media mount with reads AND writes", () => {
    const paths = (doc().paths ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    // Reads
    expect(paths["/admin/api/media"]?.get).toBeDefined();
    expect(paths["/admin/api/media/folders/root/contents"]?.get).toBeDefined();
    // Writes, gated by the scanned verbs ([GET,POST,PATCH,DELETE])
    expect(paths["/admin/api/media"]?.post).toBeDefined();
    expect(paths["/admin/api/media/{id}"]?.patch).toBeDefined();
    expect(paths["/admin/api/media/{id}"]?.delete).toBeDefined();
    // Upload is multipart, and the admin mount carries the media permission.
    const upload = paths["/admin/api/media"]?.post as Record<string, unknown>;
    const body = upload.requestBody as Record<string, unknown>;
    expect(Object.keys(body.content as object)).toContain(
      "multipart/form-data"
    );
    expect(upload["x-nextly-permission"]).toBe("create-media");
  });

  it("documents the PUBLIC media mount with GET-only reads, no writes", () => {
    const paths = (doc().paths ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(paths["/api/media"]?.get).toBeDefined();
    expect(paths["/api/media/folders"]?.get).toBeDefined();
    // The public mount re-exports only GET — writes must NOT appear.
    expect(paths["/api/media"]?.post).toBeUndefined();
    expect(paths["/api/media/{id}"]?.delete).toBeUndefined();
    // Reads on the public mount are public (no security array entries).
    const list = paths["/api/media"]?.get as Record<string, unknown>;
    expect(list.security).toEqual([]);
    expect(paths["/api/media"]?.get).toMatchObject({
      tags: ["Media (Public)"],
    });
  });

  it("documents the public health check", () => {
    const paths = (doc().paths ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(paths["/api/health"]?.get).toBeDefined();
    expect(paths["/api/health"]?.head).toBeDefined();
    const get = paths["/api/health"]?.get as Record<string, unknown>;
    expect(get.security).toEqual([]);
    expect(get.tags).toEqual(["Health"]);
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

describe("generateOpenApiDocument — publicOnly (anonymous viewer)", () => {
  it("keeps ONLY public operations and drops every gated one", () => {
    const d = generateOpenApiDocument({
      scan: scan(),
      restOperations: restOps,
      publicOnly: true,
    }) as Record<string, unknown>;
    const paths = (d.paths ?? {}) as Record<string, Record<string, unknown>>;
    // Public seam ops survive (none in this fixture — restOps are all gated),
    // gated ops are gone...
    expect(paths["/admin/api/users"]).toBeUndefined();
    expect(paths["/admin/api/me"]).toBeUndefined();
    // ...public mounted surfaces survive...
    expect(paths["/api/health"]?.get).toBeDefined();
    expect(paths["/api/media"]?.get).toBeDefined();
    // ...and the gated admin media mount is dropped entirely.
    expect(paths["/admin/api/media"]?.get).toBeUndefined();
    expect(paths["/admin/api/media"]?.post).toBeUndefined();
    // No gated op anywhere in the document.
    for (const item of Object.values(paths)) {
      for (const op of Object.values(item)) {
        const sec = JSON.stringify(
          (op as Record<string, unknown>)?.security ?? "[]"
        );
        if (sec === "[]") continue;
        throw new Error(
          "gated operation leaked into the public-only spec: " +
            JSON.stringify(op).slice(0, 80)
        );
      }
    }
  });
});

describe("generateOpenApiDocument — review regressions", () => {
  it("declares every {param} path segment as a required path parameter", () => {
    const d = generateOpenApiDocument({
      scan: scan(),
      restOperations: restOps,
    });
    const paths = (d.paths ?? {}) as Record<string, Record<string, unknown>>;
    let checked = 0;
    for (const [path, item] of Object.entries(paths)) {
      const templateNames = [...path.matchAll(/\{([A-Za-z_][\w]*)\}/g)].map(
        m => m[1]
      );
      if (templateNames.length === 0) continue;
      for (const [verb, op] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete", "head"].includes(verb))
          continue;
        const params = (op as Record<string, unknown>)?.parameters as
          Array<{ name: string; in: string; required: boolean }> | undefined;
        expect(params, `${verb} ${path} must declare parameters`).toBeDefined();
        for (const name of templateNames) {
          const match = params?.find(p => p.name === name);
          expect(match, `${verb} ${path} param ${name}`).toMatchObject({
            in: "path",
            required: true,
          });
          checked++;
        }
      }
    }
    // Positive control: the fixture has templated paths, so the loop ran.
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps operationIds unique when both media mounts exist", () => {
    const d = generateOpenApiDocument({
      scan: scan(),
      restOperations: restOps,
    });
    const ids: string[] = [];
    for (const item of Object.values(
      d.paths as Record<string, Record<string, unknown>>
    )) {
      for (const op of Object.values(item)) {
        const id = (op as Record<string, unknown>)?.operationId;
        if (typeof id === "string") ids.push(id);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
    // The two mounts qualify the same base name.
    expect(ids).toContain("listMedia.admin");
    expect(ids).toContain("listMedia.public");
  });

  it("never emits a write operation on a public media mount, even if the scan reports the verb", () => {
    const hostileScan: ScanResult = {
      routes: [
        {
          mountPath: "/api/media/[[...path]]",
          source: { kind: "media" },
          // A mis-declared public mount claiming POST — writes must still not appear.
          verbs: ["GET", "POST", "DELETE"],
        },
      ],
      unrecognized: [],
    };
    const d = generateOpenApiDocument({ scan: hostileScan });
    const paths = (d.paths ?? {}) as Record<string, Record<string, unknown>>;
    expect(paths["/api/media"]?.get).toBeDefined();
    expect(paths["/api/media"]?.post).toBeUndefined();
    expect(paths["/api/media/{id}"]?.delete).toBeUndefined();
  });

  it("keeps the templated operation when a content kind has zero surfaces (no silent drop)", () => {
    // A templated collection op in the input; the users-only restOps fixture
    // has none, so supply one representative op directly.
    const collectionList: DocsOperation = {
      service: "collections",
      operation: "listEntries",
      method: "GET",
      path: "/collections/{collectionName}/entries",
      auth: "permission",
      permissionSlug: "read-{collectionName}",
      tag: "Collections",
      envelope: "list",
    };
    const singleGet: DocsOperation = {
      service: "singles",
      operation: "getSingleDocument",
      method: "GET",
      path: "/singles/{slug}",
      auth: "permission",
      permissionSlug: "read-{slug}",
      tag: "Singles",
      envelope: "doc",
    };
    const d = generateOpenApiDocument({
      scan: scan(),
      restOperations: [...restOps, collectionList, singleGet],
      content: { collections: [], singles: [{ slug: "homepage", fields: [] }] },
    });
    const paths = (d.paths ?? {}) as Record<string, Record<string, unknown>>;
    expect(
      paths["/admin/api/collections/{collectionName}/entries"]?.get
    ).toBeDefined();
    expect(paths["/admin/api/singles/homepage"]?.get).toBeDefined();
  });
});
