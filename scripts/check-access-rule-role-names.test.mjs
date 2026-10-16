import { describe, expect, it } from "vitest";

import {
  findRoleNameRules,
  isShippedSource,
  shippedFiles,
} from "./check-access-rule-role-names.mjs";

/** The findings for fixture files, as `path:line name` for readable failures. */
function scan(files) {
  return findRoleNameRules(new Map(Object.entries(files))).map(
    ({ path, line, name }) => `${path}:${line} ${name}`
  );
}

describe("check-access-rule-role-names", () => {
  it("reports a typed rule that destructures roles", () => {
    expect(
      scan({
        "templates/t/src/access/is-admin.ts": [
          'import type { AccessControlFunction } from "nextly";',
          "export const isAdmin: AccessControlFunction = ({ roles }) =>",
          '  roles.includes("admin");',
        ].join("\n"),
      })
    ).toEqual(["templates/t/src/access/is-admin.ts:2 isAdmin"]);
  });

  it("reports a rule written inline in a collection's access", () => {
    expect(
      scan({
        "packages/plugin-x/src/posts.ts": [
          "export const Posts = defineCollection({",
          '  slug: "posts",',
          "  access: {",
          "    read: true,",
          '    update: ctx => ctx.roles.some(r => r === "editor"),',
          "  },",
          "});",
        ].join("\n"),
      })
    ).toEqual(["packages/plugin-x/src/posts.ts:5 update"]);
  });

  it("reports a field rule that reads the user's role", () => {
    expect(
      scan({
        "templates/t/src/users.ts": [
          "text({",
          '  name: "notes",',
          '  access: { read: ({ req }) => req.user?.role === "admin" },',
          "});",
        ].join("\n"),
      })
    ).toEqual(["templates/t/src/users.ts:3 read"]);
  });

  it("follows an untyped rule imported into a collection's access", () => {
    expect(
      scan({
        "templates/t/src/access/staff.ts":
          'export const staff = ({ roles }) => roles.includes("staff");',
        "templates/t/src/collections/Posts.ts": [
          'import { staff } from "../access/staff";',
          "export const Posts = defineCollection({ access: { update: staff } });",
        ].join("\n"),
      })
    ).toEqual(["templates/t/src/access/staff.ts:1 staff"]);
  });

  it("passes a rule that decides by permission", () => {
    expect(
      scan({
        "templates/t/src/access/has-permission.ts": [
          'import type { AccessControlFunction } from "nextly";',
          "export const hasPermission: AccessControlFunction = ({",
          "  permissions,",
          "  collection,",
          "  operation,",
          "}) => permissions.includes(`${collection}:${operation}`);",
        ].join("\n"),
        "templates/t/src/collections/Posts.ts": [
          'import { hasPermission } from "../access/has-permission";',
          "export const Posts = defineCollection({",
          "  access: { read: () => true, update: hasPermission },",
          "});",
        ].join("\n"),
      })
    ).toEqual([]);
  });

  it("passes code that reads roles outside any access rule", () => {
    // A seed creating roles and a route checking super-admin are not rules, and
    // prose naming a role is not code.
    expect(
      scan({
        "templates/t/src/seed.ts": [
          "// The author role: `roles.includes('author')` is not checked here.",
          "export async function seed(nextly) {",
          "  const existing = await nextly.roles.find({ limit: 100 });",
          "  return existing.items.map(r => r.role);",
          "}",
        ].join("\n"),
      })
    ).toEqual([]);
  });

  it("scans shipped source only", () => {
    expect(isShippedSource("templates/blog/src/access/anyone.ts")).toBe(true);
    expect(
      isShippedSource("packages/plugin-form-builder/src/collections/x.ts")
    ).toBe(true);
    expect(isShippedSource("packages/nextly/src/auth/x.ts")).toBe(false);
    expect(
      isShippedSource("packages/plugin-form-builder/src/collections/x.test.ts")
    ).toBe(false);
    expect(
      isShippedSource("packages/plugin-form-builder/src/__tests__/x.ts")
    ).toBe(false);
  });

  it("finds no shipped access rule that reads a role", () => {
    const files = shippedFiles();
    // A control on the population: an empty listing would pass vacuously.
    expect(files.has("templates/blog/src/collections/Posts/index.ts")).toBe(
      true
    );
    expect(
      files.has(
        "packages/plugin-form-builder/src/collections/access-defaults.ts"
      )
    ).toBe(true);
    expect(findRoleNameRules(files)).toEqual([]);
  });
});
