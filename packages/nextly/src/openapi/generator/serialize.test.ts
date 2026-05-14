import { describe, expect, it } from "vitest";

import type { DocumentIR, OperationIR, ResponseIR } from "../ir/types";

import { serialize } from "./serialize";

const minimalDoc: DocumentIR = {
  openapi: "3.1.0",
  info: { title: "Test API", version: "1.0.0" },
  servers: [],
  tags: [],
  operations: [],
  components: {
    schemas: {},
    responses: {},
    parameters: {},
    requestBodies: {},
    securitySchemes: {},
  },
  extensions: {},
};

function docWithOp(op: OperationIR, extras?: Partial<DocumentIR>): DocumentIR {
  return {
    ...minimalDoc,
    operations: [op],
    ...extras,
    components: {
      ...minimalDoc.components,
      ...(extras?.components ?? {}),
    },
  };
}

function makeOp(overrides: Partial<OperationIR> = {}): OperationIR {
  return {
    path: "/api/posts",
    method: "GET",
    versions: ["1.0"],
    operationId: "posts.list",
    tags: ["Posts"],
    parameters: [],
    responses: {
      "200": {
        description: "ok",
        content: {
          "application/json": { schema: { type: "object" } },
        },
      } satisfies ResponseIR,
    },
    security: [],
    extensions: {},
    ...overrides,
  };
}

describe("serialize — JSON output", () => {
  it("serializes a minimal document", () => {
    const buf = serialize(minimalDoc, "json");
    const parsed = JSON.parse(buf.toString("utf8"));
    expect(parsed.openapi).toBe("3.1.0");
    expect(parsed.info.title).toBe("Test API");
    expect(parsed.info.version).toBe("1.0.0");
  });

  it("does not emit empty arrays / empty components", () => {
    const buf = serialize(minimalDoc, "json");
    const parsed = JSON.parse(buf.toString("utf8"));
    expect(parsed.servers).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
    // components is still present (always emitted), but its sub-keys
    // should be omitted when empty for a tidy spec.
    expect(parsed.components.schemas).toBeUndefined();
    expect(parsed.components.responses).toBeUndefined();
  });

  it("returns a Buffer", () => {
    const buf = serialize(minimalDoc, "json");
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it("emits a paths block keyed by path then lowercased method", () => {
    const doc = docWithOp(makeOp({ method: "GET", path: "/api/posts" }));
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(parsed.paths["/api/posts"]).toBeDefined();
    expect(parsed.paths["/api/posts"].get).toBeDefined();
    expect(parsed.paths["/api/posts"].get.operationId).toBe("posts.list");
  });

  it("groups multiple methods on the same path together", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({ method: "GET", operationId: "posts.list" }),
        makeOp({
          method: "POST",
          operationId: "posts.create",
          tags: ["Posts"],
        }),
      ],
    };
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(Object.keys(parsed.paths["/api/posts"]).sort()).toEqual([
      "get",
      "post",
    ]);
  });

  it("omits operation fields that are empty / undefined", () => {
    const op = makeOp({
      tags: [],
      parameters: [],
      security: [],
      // no summary / no description / no deprecated
    });
    const parsed = JSON.parse(
      serialize(docWithOp(op), "json").toString("utf8")
    );
    const getOp = parsed.paths["/api/posts"].get;
    expect(getOp.tags).toBeUndefined();
    expect(getOp.parameters).toBeUndefined();
    expect(getOp.security).toBeUndefined();
    expect(getOp.summary).toBeUndefined();
    expect(getOp.description).toBeUndefined();
    expect(getOp.deprecated).toBeUndefined();
  });

  it("emits summary / description / deprecated when set", () => {
    const op = makeOp({
      summary: "List posts",
      description: "Returns paginated posts.",
      deprecated: true,
    });
    const parsed = JSON.parse(
      serialize(docWithOp(op), "json").toString("utf8")
    );
    const getOp = parsed.paths["/api/posts"].get;
    expect(getOp.summary).toBe("List posts");
    expect(getOp.description).toBe("Returns paginated posts.");
    expect(getOp.deprecated).toBe(true);
  });

  it("spreads document-level and operation-level x-* extensions verbatim", () => {
    const op = makeOp({ extensions: { "x-nextly-since": "0.5.0" } });
    const doc: DocumentIR = {
      ...docWithOp(op),
      extensions: { "x-nextly-build-sha": "abc123" },
    };
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(parsed["x-nextly-build-sha"]).toBe("abc123");
    expect(parsed.paths["/api/posts"].get["x-nextly-since"]).toBe("0.5.0");
  });

  it("retains components when populated", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      components: {
        schemas: { Post: { type: "object" } },
        responses: {
          NotFound: {
            description: "not found",
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
        },
        parameters: {},
        requestBodies: {},
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    };
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(parsed.components.schemas.Post).toEqual({ type: "object" });
    expect(parsed.components.responses.NotFound.description).toBe("not found");
    expect(parsed.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });
    // parameters & requestBodies were empty -> omitted
    expect(parsed.components.parameters).toBeUndefined();
    expect(parsed.components.requestBodies).toBeUndefined();
  });
});

describe("serialize — YAML output", () => {
  it("serializes a minimal document to YAML", () => {
    const buf = serialize(minimalDoc, "yaml");
    const text = buf.toString("utf8");
    expect(text.startsWith("openapi: 3.1.0")).toBe(true);
    expect(text).toContain("info:");
    expect(text).toContain("title: Test API");
  });

  it("returns a Buffer for YAML too", () => {
    const buf = serialize(minimalDoc, "yaml");
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});

describe("serialize — $ref validation", () => {
  it("accepts well-formed refs to registered schemas", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Post" },
                },
              },
            },
          },
        }),
      ],
      components: {
        ...minimalDoc.components,
        schemas: { Post: { type: "object" } },
      },
    };
    expect(() => serialize(doc, "json")).not.toThrow();
  });

  it("throws on a dangling $ref to a missing schema", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Missing" },
                },
              },
            },
          },
        }),
      ],
    };
    expect(() => serialize(doc, "json")).toThrow(/dangling \$ref.*Missing/i);
  });

  it("throws on a dangling $ref to a missing response", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({
          responses: {
            "401": { $ref: "#/components/responses/Imaginary" },
          },
        }),
      ],
    };
    expect(() => serialize(doc, "json")).toThrow(/dangling \$ref.*Imaginary/i);
  });

  it("validates nested $refs inside oneOf arrays", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { type: "string" },
                      { $ref: "#/components/schemas/User" },
                      { $ref: "#/components/schemas/Admin" },
                    ],
                  },
                },
              },
            },
          },
        }),
      ],
      components: {
        ...minimalDoc.components,
        schemas: { User: { type: "object" } /* Admin missing */ },
      },
    };
    expect(() => serialize(doc, "json")).toThrow(/Admin/);
  });

  it("validates $refs inside `paths` walked through requestBody", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({
          method: "POST",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NonExistent" },
              },
            },
          },
        }),
      ],
    };
    expect(() => serialize(doc, "json")).toThrow(/NonExistent/);
  });

  it("ignores non-schema/responses ref namespaces (forward-compatible)", () => {
    // OAS supports many $ref types (parameters, requestBodies, examples,
    // headers, links, callbacks). Currently only validates schemas + responses;
    // others pass through so downstream validators handle them.
    const doc: DocumentIR = {
      ...minimalDoc,
      operations: [
        makeOp({
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              // Pretend this is a $ref to a parameter component — that
              // namespace is currently not validated here.
              schema: { $ref: "#/components/examples/SampleId" },
            },
          ],
        }),
      ],
    };
    expect(() => serialize(doc, "json")).not.toThrow();
  });
});

describe("serialize — info / servers / tags", () => {
  it("emits info verbatim", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      info: {
        title: "Acme",
        version: "1.2.3",
        description: "Hi.",
        contact: { email: "x@y.z" },
      },
    };
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(parsed.info).toEqual({
      title: "Acme",
      version: "1.2.3",
      description: "Hi.",
      contact: { email: "x@y.z" },
    });
  });

  it("emits servers when present", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      servers: [{ url: "https://api.example.com", description: "prod" }],
    };
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(parsed.servers).toEqual([
      { url: "https://api.example.com", description: "prod" },
    ]);
  });

  it("emits tags when present", () => {
    const doc: DocumentIR = {
      ...minimalDoc,
      tags: [{ name: "Posts", description: "Editorial content." }],
    };
    const parsed = JSON.parse(serialize(doc, "json").toString("utf8"));
    expect(parsed.tags).toEqual([
      { name: "Posts", description: "Editorial content." },
    ]);
  });
});
