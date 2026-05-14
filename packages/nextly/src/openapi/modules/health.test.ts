import { describe, expect, it } from "vitest";

import { healthModule } from "./health";

describe("healthModule", () => {
  it("is named 'health'", () => {
    expect(healthModule.name).toBe("health");
  });

  it("emits a Health tag with a description", () => {
    expect(healthModule.tag).toEqual({
      name: "Health",
      description: "Service liveness and readiness probes.",
    });
  });

  it("declares two operations on /api/health: GET + HEAD", () => {
    const summary = healthModule.operations.map(
      o => `${o.method} ${o.path} (${o.operationId})`
    );
    expect(summary.sort()).toEqual([
      "GET /api/health (health.get)",
      "HEAD /api/health (health.head)",
    ]);
  });

  describe("GET /api/health", () => {
    const get = healthModule.operations.find(o => o.method === "GET")!;

    it("is public — security: [] (no auth required)", () => {
      expect(get.security).toEqual([]);
    });

    it("200 references HealthResponse", () => {
      const schema = (
        get.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/HealthResponse",
      });
    });

    it("503 references the shared ServiceUnavailable response", () => {
      expect(get.responses["503"]).toEqual({
        $ref: "#/components/responses/ServiceUnavailable",
      });
    });
  });

  describe("HEAD /api/health", () => {
    const head = healthModule.operations.find(o => o.method === "HEAD")!;

    it("is public — security: []", () => {
      expect(head.security).toEqual([]);
    });

    it("declares 200 and 503 status codes with no response body", () => {
      expect(head.responses["200"]).toMatchObject({
        description: expect.any(String) as unknown,
      });
      // HEAD responses should not declare content (no body)
      expect(
        (head.responses["200"] as { content?: unknown }).content
      ).toBeUndefined();
      expect(head.responses["503"]).toMatchObject({
        description: expect.any(String) as unknown,
      });
    });
  });

  describe("HealthResponse schema", () => {
    const schema = healthModule.schemas?.HealthResponse as {
      type?: string;
      required?: string[];
      properties?: Record<string, unknown>;
    };

    it("is an object with required ok + version", () => {
      expect(schema?.type).toBe("object");
      expect(schema?.required).toEqual(["ok", "version"]);
    });

    it("declares ok / version / uptime / timestamp / database properties", () => {
      const propNames = Object.keys(schema?.properties ?? {}).sort();
      expect(propNames).toEqual([
        "database",
        "ok",
        "timestamp",
        "uptime",
        "version",
      ]);
    });

    it("timestamp uses format: 'date-time'", () => {
      const ts = (schema?.properties as Record<string, { format?: string }>)
        .timestamp;
      expect(ts?.format).toBe("date-time");
    });

    it("database is open-shaped (additionalProperties: true)", () => {
      const db = (
        schema?.properties as Record<string, { additionalProperties?: unknown }>
      ).database;
      expect(db?.additionalProperties).toBe(true);
    });
  });
});
