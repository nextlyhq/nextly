/**
 * The paths a public route pre-renders: its entries, the root when it has
 * none, and a failed read failing the build unless the database simply has
 * not had its plugins installed yet.
 */
import { describe, expect, it } from "vitest";

import { pathsOrRoot } from "../../src/lib/static-params";

const answering = (params: Array<{ slug: string[] }>) => ({
  generateStaticParams: async () => params,
});
const failing = (error: unknown) => ({
  generateStaticParams: async (): Promise<Array<{ slug: string[] }>> => {
    throw error;
  },
});
const notInstalled = Object.assign(new Error("not installed"), {
  code: "PLUGIN_NOT_INSTALLED",
});

describe("pathsOrRoot", () => {
  it("builds every path the route names", async () => {
    expect(await pathsOrRoot(answering([{ slug: ["a"] }]))).toEqual([
      { slug: ["a"] },
    ]);
  });

  it("builds the root when the route names none", async () => {
    expect(await pathsOrRoot(answering([]))).toEqual([{ slug: [] }]);
  });

  it("builds the root on a database whose plugins are not installed yet", async () => {
    expect(await pathsOrRoot(failing(notInstalled))).toEqual([{ slug: [] }]);
    expect(
      await pathsOrRoot(failing(new Error("wrapped", { cause: notInstalled })))
    ).toEqual([{ slug: [] }]);
  });

  it("fails the build on any other failed read", async () => {
    const broken = new Error("no such column: slug");
    await expect(pathsOrRoot(failing(broken))).rejects.toBe(broken);
  });
});
