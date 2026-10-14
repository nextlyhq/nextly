/**
 * The drizzle v1 legacy gate's RQB callback-filter rule, held to every form
 * of the removed filter it must refuse and to the builder methods and the
 * keys that merely end in `where` it must leave alone.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { rqbCallbackFilterLines } = require("./drizzle-v1-legacy-rules.cjs");

describe("the RQB callback-filter rule", () => {
  it.each([
    [
      "spaced",
      "db.query.users.findMany({ where: (t, { eq }) => eq(t.id, 1) });",
    ],
    ["compact", "db.query.users.findMany({where:(t,ops)=>ops.eq(t.id, 1)});"],
    ["async", "findMany({ where: async (t, ops) => ops.eq(t.id, 1) });"],
    [
      "after an opening brace",
      "findFirst({where: (users, { eq }) => eq(users.id, id)})",
    ],
    [
      "after a comma",
      "findMany({ with: { posts: true }, where: (t, { eq }) => eq(t.a, 1) })",
    ],
    [
      "with a space before the colon",
      "findMany({ where : (t, { eq }) => eq(t.a, 1) })",
    ],
  ])("refuses the filter %s", (_form, line) => {
    expect(rqbCallbackFilterLines(line)).toEqual([1]);
  });

  it("refuses a filter split across lines, on the line where it begins", () => {
    const text = [
      "const rows = await db.query.users.findMany({",
      "  where:",
      "    (t, ops) =>",
      "      ops.eq(t.id, 1),",
      "});",
    ].join("\n");

    expect(rqbCallbackFilterLines(text)).toEqual([2]);
  });

  it.each([
    [
      "signOutEverywhere:",
      "  signOutEverywhere: (server, visitor) => server.signOutEverywhere({ visitor }),",
    ],
    ["somewhere:", "const map = { somewhere: (a, b) => a + b };"],
    ["$where:", "const x = { $where: (a, b) => a };"],
    ["nowhere:", "const x = { nowhere: (a, { b }) => a };"],
  ])("leaves a key that only ends in where (%s)", (_key, line) => {
    expect(rqbCallbackFilterLines(line)).toEqual([]);
  });

  it.each([
    ["a mock's zero-parameter where", "const chain = { where: () => chain };"],
    [
      "an implementation's one-parameter where",
      "  where: condition => this.filter(condition),",
    ],
    ["a declaration's annotated where", "  where: (cond: unknown) => {"],
  ])("leaves %s, a builder's own method", (_form, line) => {
    expect(rqbCallbackFilterLines(line)).toEqual([]);
  });

  it("leaves a documented example in a comment", () => {
    const text = [
      "/**",
      " * findMany({ where: (t, { eq }) => eq(t.id, 1) }) filters nothing in v1.",
      " */",
      "// where: (t, ops) => ops.eq(t.id, 1)",
    ].join("\n");

    expect(rqbCallbackFilterLines(text)).toEqual([]);
  });

  it("names every filter in a file by its line", () => {
    const text = [
      "a.findMany({ where: (t, { eq }) => eq(t.id, 1) });",
      "const ok = { signOutEverywhere: (s, v) => s };",
      "b.findMany({",
      "  where: (t, ops) => ops.eq(t.id, 2),",
      "});",
    ].join("\n");

    expect(rqbCallbackFilterLines(text)).toEqual([1, 4]);
  });
});
