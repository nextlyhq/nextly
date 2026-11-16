/**
 * The one place the list read's refusal shape is named: each check in the
 * chain refuses with a validation error naming its problems, and only that
 * reads as an answer. Fed here the real error each shared refuser throws, and
 * the failures that must never read as "nothing to refuse".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

vi.mock("../../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../services/lib/permissions")
  >()),
  isSuperAdmin: vi.fn(async () => false),
  listRoleSlugsForUser: vi.fn(async () => []),
  listEffectiveGrants: vi.fn(async () => []),
  listEffectivePermissions: vi.fn(async () => []),
}));

import { NextlyError } from "../../../../errors/nextly-error";
import * as registry from "../../../../shared/lib/field-level-registry";
import {
  assertFieldGroupPathsFilterable,
  assertFilterableFields,
  assertGroupableField,
  assertNoHiddenFieldQueried,
  assertSortableField,
  refuseHiddenColumnFilter,
} from "../../../../shared/lib/filterable-fields";
import {
  refuseFilterProblems,
  unknownFieldProblem,
} from "../../query/filter-shape";
import { queryRefusalProblems } from "../collection-query-service";

const USER = { id: "u1" };
const HIDDEN = () => false;

afterEach(() => registry.clearFieldFunctions());

/** What `fn` threw. */
async function thrownBy(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("queryRefusalProblems", () => {
  it.each<[string, () => unknown, string]>([
    [
      "a filter on a field the caller may not read",
      () => {
        registry.registerFieldFunctions("collection", "vaults", [
          { name: "codename", access: { read: HIDDEN } },
        ]);
        return assertFilterableFields(
          "collection",
          "vaults",
          { codename: { equals: "x" } },
          { caller: { user: USER } }
        );
      },
      "where.codename",
    ],
    [
      "a sort on one",
      () => {
        registry.registerFieldFunctions("collection", "vaults", [
          { name: "codename", access: { read: HIDDEN } },
        ]);
        return assertSortableField("collection", "vaults", ["codename"], {
          caller: { user: USER },
        });
      },
      "codename",
    ],
    [
      "a group key on one",
      () => {
        registry.registerFieldFunctions("collection", "vaults", [
          { name: "codename", access: { read: HIDDEN } },
        ]);
        return assertGroupableField("collection", "vaults", "codename", {
          caller: { user: USER },
        });
      },
      "codename",
    ],
    [
      "a filter on a field-group field its group hides",
      () => {
        registry.registerFieldFunctions("fieldGroup", "note", [
          { name: "secret", access: { read: HIDDEN } },
        ]);
        return assertFieldGroupPathsFilterable(
          [
            {
              key: "one.secret",
              componentSlugs: ["note"],
              componentFieldPath: "secret",
            },
          ],
          { caller: { user: USER } }
        );
      },
      "one.secret",
    ],
    [
      "a filter on a hidden column",
      () => refuseHiddenColumnFilter(["leakProbe"]),
      "where.leakProbe",
    ],
    [
      "a filter on a field the read leaves out",
      () =>
        assertNoHiddenFieldQueried(
          { where: { title: { equals: "x" } } },
          new Set(["title"])
        ),
      "title",
    ],
    [
      "a filter on what a release holds, refused as the release check does",
      // The release check is private to the service; this is its refusal,
      // made by the same two calls it makes.
      () =>
        refuseFilterProblems([
          unknownFieldProblem("where._inRelease", "_inRelease"),
        ]),
      "where._inRelease",
    ],
  ])("reads %s as its problems", async (_case, refuse, path) => {
    const problems = queryRefusalProblems(await thrownBy(refuse));
    expect(problems?.length).toBeGreaterThan(0);
    expect(JSON.stringify(problems)).toContain(path);
  });

  it.each<[string, unknown]>([
    ["a database failure", new Error("connection reset")],
    ["a refusal of another kind", NextlyError.notFound({ logContext: {} })],
    [
      // Problems named, under another code: a refusal for a reason the read's
      // chain never gives, so not one of its answers.
      "another code that names problems",
      new NextlyError({
        code: "FORBIDDEN",
        publicMessage: "No.",
        publicData: {
          errors: [{ path: "where.a", code: "X", message: "No." }],
        },
      }),
    ],
    [
      "a validation error naming no problem",
      NextlyError.validation({ errors: [] }),
    ],
    [
      "an object that only looks like one",
      {
        code: "VALIDATION_ERROR",
        publicData: { errors: [{ path: "a", code: "b", message: "c" }] },
      },
    ],
    ["nothing at all", undefined],
  ])("reads %s as no answer", (_case, error) => {
    expect(queryRefusalProblems(error)).toBeUndefined();
  });
});
