import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { OperationIR } from "../ir/types";

import { inferFromCollections } from "./infer-collections";

const Posts: CollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "body", type: "textarea" },
  ],
};

function byOp(operations: readonly OperationIR[]) {
  return Object.fromEntries(operations.map(op => [op.operationId, op]));
}

describe("inferFromCollections — operations", () => {
  it("emits six CRUD operations per collection", () => {
    const { operations } = inferFromCollections([Posts]);
    const ids = operations.map(o => o.operationId).sort();
    expect(ids).toEqual([
      "posts.count",
      "posts.create",
      "posts.delete",
      "posts.findById",
      "posts.list",
      "posts.update",
    ]);
  });

  it("uses the labels.plural as the tag for every operation", () => {
    const { operations } = inferFromCollections([Posts]);
    for (const op of operations) {
      expect(op.tags).toEqual(["Posts"]);
    }
  });

  it("falls back to the slug when labels.plural is missing", () => {
    const NoLabel: CollectionConfig = {
      slug: "tags",
      fields: [{ name: "name", type: "text" }],
    };
    const { operations } = inferFromCollections([NoLabel]);
    expect(operations[0]?.tags).toEqual(["tags"]);
  });

  it("paths follow /api/{slug} and /api/{slug}/{id} conventions", () => {
    const { operations } = inferFromCollections([Posts]);
    const ops = byOp(operations);
    expect(ops["posts.list"]?.path).toBe("/api/posts");
    expect(ops["posts.count"]?.path).toBe("/api/posts/count");
    expect(ops["posts.findById"]?.path).toBe("/api/posts/{id}");
    expect(ops["posts.create"]?.path).toBe("/api/posts");
    expect(ops["posts.update"]?.path).toBe("/api/posts/{id}");
    expect(ops["posts.delete"]?.path).toBe("/api/posts/{id}");
  });

  it("methods are GET / GET / GET / POST / PATCH / DELETE", () => {
    const { operations } = inferFromCollections([Posts]);
    const ops = byOp(operations);
    expect(ops["posts.list"]?.method).toBe("GET");
    expect(ops["posts.count"]?.method).toBe("GET");
    expect(ops["posts.findById"]?.method).toBe("GET");
    expect(ops["posts.create"]?.method).toBe("POST");
    expect(ops["posts.update"]?.method).toBe("PATCH");
    expect(ops["posts.delete"]?.method).toBe("DELETE");
  });

  it("every operation declares all three security schemes", () => {
    const { operations } = inferFromCollections([Posts]);
    for (const op of operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("every operation reserves versions: ['1.0'] (dormant scaffolding)", () => {
    const { operations } = inferFromCollections([Posts]);
    for (const op of operations) {
      expect(op.versions).toEqual(["1.0"]);
    }
  });
});

describe("inferFromCollections — list/count parameters", () => {
  it("list has limit/offset/sort/where/populate/search/locale query params", () => {
    const { operations } = inferFromCollections([Posts]);
    const list = byOp(operations)["posts.list"]!;
    const paramNames = list.parameters.map(p => p.name).sort();
    expect(paramNames).toEqual([
      "limit",
      "locale",
      "offset",
      "populate",
      "search",
      "sort",
      "where",
    ]);
    expect(list.parameters.every(p => p.in === "query")).toBe(true);
    expect(list.parameters.every(p => p.required === false)).toBe(true);
  });

  it("count has where/search/locale but NOT limit/offset/sort/populate", () => {
    const { operations } = inferFromCollections([Posts]);
    const count = byOp(operations)["posts.count"]!;
    const paramNames = count.parameters.map(p => p.name).sort();
    expect(paramNames).toEqual(["locale", "search", "where"]);
  });

  it("findById/update/delete have an `id` path parameter", () => {
    const { operations } = inferFromCollections([Posts]);
    for (const id of ["posts.findById", "posts.update", "posts.delete"]) {
      const op = byOp(operations)[id]!;
      const idParam = op.parameters.find(p => p.name === "id");
      expect(idParam).toBeDefined();
      expect(idParam?.in).toBe("path");
      expect(idParam?.required).toBe(true);
    }
  });
});

describe("inferFromCollections — request bodies", () => {
  it("create requestBody references CreatePost", () => {
    const { operations } = inferFromCollections([Posts]);
    const create = byOp(operations)["posts.create"]!;
    const schema = create.requestBody?.content["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/CreatePost" });
    expect(create.requestBody?.required).toBe(true);
  });

  it("update requestBody references UpdatePost", () => {
    const { operations } = inferFromCollections([Posts]);
    const update = byOp(operations)["posts.update"]!;
    const schema = update.requestBody?.content["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/UpdatePost" });
  });

  it("delete / list / count / findById have NO request body", () => {
    const { operations } = inferFromCollections([Posts]);
    const ops = byOp(operations);
    expect(ops["posts.delete"]?.requestBody).toBeUndefined();
    expect(ops["posts.list"]?.requestBody).toBeUndefined();
    expect(ops["posts.count"]?.requestBody).toBeUndefined();
    expect(ops["posts.findById"]?.requestBody).toBeUndefined();
  });
});

describe("inferFromCollections — responses", () => {
  it("list 200 references ListResponsePost", () => {
    const { operations } = inferFromCollections([Posts]);
    const list = byOp(operations)["posts.list"]!;
    const schema = (
      list.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/ListResponsePost",
    });
  });

  it("count 200 references CountResponse (shared, no name-mangling)", () => {
    const { operations } = inferFromCollections([Posts]);
    const count = byOp(operations)["posts.count"]!;
    const schema = (
      count.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/CountResponse" });
  });

  it("findById 200 references the bare Post (not MutationResponsePost)", () => {
    const { operations } = inferFromCollections([Posts]);
    const find = byOp(operations)["posts.findById"]!;
    const schema = (
      find.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/Post" });
  });

  it("create 201 references MutationResponsePost", () => {
    const { operations } = inferFromCollections([Posts]);
    const create = byOp(operations)["posts.create"]!;
    expect(create.responses["201"]).toBeDefined();
    const schema = (
      create.responses["201"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/MutationResponsePost",
    });
  });

  it("update 200 references MutationResponsePost", () => {
    const { operations } = inferFromCollections([Posts]);
    const update = byOp(operations)["posts.update"]!;
    const schema = (
      update.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/MutationResponsePost",
    });
  });

  it("delete 200 references DeleteResponse (not MutationResponse — item is { id } only)", () => {
    const { operations } = inferFromCollections([Posts]);
    const del = byOp(operations)["posts.delete"]!;
    const schema = (
      del.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/DeleteResponse" });
  });

  it("every operation references Unauthorized, Forbidden, RateLimited, InternalServerError", () => {
    const { operations } = inferFromCollections([Posts]);
    for (const op of operations) {
      expect(op.responses["401"]).toEqual({
        $ref: "#/components/responses/Unauthorized",
      });
      expect(op.responses["403"]).toEqual({
        $ref: "#/components/responses/Forbidden",
      });
      expect(op.responses["429"]).toEqual({
        $ref: "#/components/responses/RateLimited",
      });
      expect(op.responses["500"]).toEqual({
        $ref: "#/components/responses/InternalServerError",
      });
    }
  });

  it("by-id operations include 404 NotFound", () => {
    const { operations } = inferFromCollections([Posts]);
    const ops = byOp(operations);
    for (const id of ["posts.findById", "posts.update", "posts.delete"]) {
      expect(ops[id]?.responses["404"]).toEqual({
        $ref: "#/components/responses/NotFound",
      });
    }
  });

  it("create / update include 400 ValidationError", () => {
    const { operations } = inferFromCollections([Posts]);
    const ops = byOp(operations);
    for (const id of ["posts.create", "posts.update"]) {
      expect(ops[id]?.responses["400"]).toEqual({
        $ref: "#/components/responses/ValidationError",
      });
    }
  });
});

describe("inferFromCollections — schemas", () => {
  it("emits Post / CreatePost / UpdatePost from deriveCollectionSchemas", () => {
    const { schemas } = inferFromCollections([Posts]);
    expect(schemas.Post).toBeDefined();
    expect(schemas.CreatePost).toBeDefined();
    expect(schemas.UpdatePost).toBeDefined();
  });

  it("emits ListResponsePost / MutationResponsePost / BulkResponsePost envelopes", () => {
    const { schemas } = inferFromCollections([Posts]);
    expect(schemas.ListResponsePost).toBeDefined();
    expect(schemas.MutationResponsePost).toBeDefined();
    expect(schemas.BulkResponsePost).toBeDefined();
  });

  it("registers repeater item schemas via deriveNestedItemSchemas", () => {
    const PostsWithBlocks: CollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          name: "blocks",
          type: "repeater",
          fields: [{ name: "heading", type: "text" }],
        },
      ],
    };
    const { schemas } = inferFromCollections([PostsWithBlocks]);
    expect(schemas.Post__BlocksItem).toBeDefined();
  });

  it("emits per-collection envelopes for every collection in one pass", () => {
    const Users: CollectionConfig = {
      slug: "users",
      labels: { singular: "User", plural: "Users" },
      fields: [{ name: "email", type: "email" }],
    };
    const { schemas } = inferFromCollections([Posts, Users]);
    expect(schemas.ListResponsePost).toBeDefined();
    expect(schemas.ListResponseUser).toBeDefined();
  });

  it("returns empty arrays / empty schemas object when no collections", () => {
    const { operations, schemas } = inferFromCollections([]);
    expect(operations).toEqual([]);
    expect(schemas).toEqual({});
  });
});
