// Phase 4: pin the canonical response-shape helpers so the wire format
// stays stable across every endpoint. Any drift here surfaces as test
// failures before reaching consumers.

import { describe, expect, it } from "vitest";

import {
  respondAction,
  respondCount,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../response-shapes";

async function bodyOf(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

describe("respondList", () => {
  it("emits { items, meta } body and 200 status with application/json", async () => {
    const meta = {
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    };
    const res = respondList([{ id: "a" }, { id: "b" }], meta);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await bodyOf(res)).toEqual({
      items: [{ id: "a" }, { id: "b" }],
      meta,
    });
  });
});

describe("respondDoc", () => {
  it("emits bare doc body and 200 status", async () => {
    const res = respondDoc({ id: "a", name: "Test" });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ id: "a", name: "Test" });
  });
});

describe("respondMutation", () => {
  it("emits { message, item } body and 200 status by default", async () => {
    const res = respondMutation("Updated.", { id: "a", name: "X" });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({
      message: "Updated.",
      item: { id: "a", name: "X" },
    });
  });

  it("supports 201 for create via init.status", async () => {
    const res = respondMutation("Created.", { id: "a" }, { status: 201 });
    expect(res.status).toBe(201);
  });
});

describe("respondAction", () => {
  it("emits { message, ...result } body", async () => {
    const res = respondAction("Logged in.", { token: "x", expiresIn: 60 });
    expect(await bodyOf(res)).toEqual({
      message: "Logged in.",
      token: "x",
      expiresIn: 60,
    });
  });

  it("works without a result payload", async () => {
    const res = respondAction("Logged out.");
    expect(await bodyOf(res)).toEqual({ message: "Logged out." });
  });
});

describe("respondData", () => {
  it("emits raw object body without wrapping", async () => {
    const res = respondData({ ok: true, version: "0.1.0" });
    expect(await bodyOf(res)).toEqual({ ok: true, version: "0.1.0" });
  });
});

describe("respondCount", () => {
  it("emits { total: N } body", async () => {
    const res = respondCount(47);
    expect(await bodyOf(res)).toEqual({ total: 47 });
  });
});
