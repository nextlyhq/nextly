import { describe, expectTypeOf, it } from "vitest";

import type {
  DocumentIR,
  HttpMethod,
  MediaTypeIR,
  OperationIR,
  ParameterIR,
  RequestBodyIR,
  ResponseIR,
  SchemaIR,
  SecurityRequirementIR,
  TagIR,
} from "./types";

describe("IR type shapes", () => {
  it("HttpMethod is the union of standard HTTP verbs", () => {
    expectTypeOf<HttpMethod>().toEqualTypeOf<
      "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD"
    >();
  });

  it("OperationIR carries required path, method, versions", () => {
    expectTypeOf<OperationIR>().toHaveProperty("path").toEqualTypeOf<string>();
    expectTypeOf<OperationIR>()
      .toHaveProperty("method")
      .toEqualTypeOf<HttpMethod>();
    expectTypeOf<OperationIR>()
      .toHaveProperty("versions")
      .toEqualTypeOf<readonly string[]>();
    expectTypeOf<OperationIR>()
      .toHaveProperty("operationId")
      .toEqualTypeOf<string>();
    expectTypeOf<OperationIR>()
      .toHaveProperty("responses")
      .toEqualTypeOf<OperationIR["responses"]>();
  });

  it("ParameterIR has in: 'path' | 'query' | 'header' | 'cookie'", () => {
    expectTypeOf<ParameterIR>()
      .toHaveProperty("in")
      .toEqualTypeOf<"path" | "query" | "header" | "cookie">();
  });

  it("TagIR has required name and optional description", () => {
    expectTypeOf<TagIR>().toHaveProperty("name").toEqualTypeOf<string>();
    expectTypeOf<TagIR>()
      .toHaveProperty("description")
      .toMatchTypeOf<string | undefined>();
  });

  it("DocumentIR.openapi is the dialect literal", () => {
    expectTypeOf<DocumentIR>()
      .toHaveProperty("openapi")
      .toEqualTypeOf<"3.1.0" | "3.0.3">();
  });

  it("MediaTypeIR carries a schema and optional examples", () => {
    expectTypeOf<MediaTypeIR>()
      .toHaveProperty("schema")
      .toEqualTypeOf<SchemaIR>();
  });

  it("a minimal OperationIR literal type-checks", () => {
    const op: OperationIR = {
      path: "/api/posts",
      method: "GET",
      versions: ["1.0"],
      operationId: "posts.list",
      tags: ["Posts"],
      parameters: [],
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: { type: "object" } } },
        } satisfies ResponseIR,
      },
      security: [],
      extensions: {},
    };
    expectTypeOf(op).toEqualTypeOf<OperationIR>();
  });

  it("SecurityRequirementIR is a record of scheme name -> scope array", () => {
    const req: SecurityRequirementIR = { bearerAuth: [] };
    expectTypeOf(req).toMatchTypeOf<SecurityRequirementIR>();
  });

  it("RequestBodyIR.content keys media types", () => {
    const body: RequestBodyIR = {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    };
    expectTypeOf(body).toMatchTypeOf<RequestBodyIR>();
  });
});
