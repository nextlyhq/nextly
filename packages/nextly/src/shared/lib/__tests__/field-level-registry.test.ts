import { afterEach, describe, expect, it } from "vitest";

import { validateEntryData } from "../entry-validation";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  attachFieldValidators,
  clearFieldFunctions,
  getFieldFunctions,
  registerFieldFunctions,
  runFieldHooks,
} from "../field-level-registry";

afterEach(() => clearFieldFunctions());

describe("field-level registry", () => {
  it("captures only function-bearing fields and replaces on re-register", () => {
    registerFieldFunctions("collection", "posts", [
      { name: "plain", type: "text" },
      { name: "secret", type: "text", access: { read: () => false } },
    ]);
    expect(Object.keys(getFieldFunctions("collection", "posts")!)).toEqual([
      "secret",
    ]);

    registerFieldFunctions("collection", "posts", [
      { name: "plain", type: "text" },
    ]);
    expect(getFieldFunctions("collection", "posts")).toBeUndefined();
  });

  it("write access strips denied fields silently; overrideAccess bypasses", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "internalScore",
        type: "number",
        access: {
          update: ({ req }: { req: { user?: { role?: string } } }) =>
            req.user?.role === "admin",
        },
      },
    ]);

    const data: Record<string, unknown> = { title: "t", internalScore: 9 };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { role: "editor" },
    });
    expect(data).toEqual({ title: "t" });

    const trusted: Record<string, unknown> = { internalScore: 9 };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: trusted,
      operation: "update",
      user: { role: "editor" },
      overrideAccess: true,
    });
    expect(trusted).toEqual({ internalScore: 9 });
  });

  it("read access strips denied fields and fails secure on throwing rules", async () => {
    registerFieldFunctions("collection", "posts", [
      { name: "hidden", type: "text", access: { read: () => false } },
      {
        name: "broken",
        type: "text",
        access: {
          read: () => {
            throw new Error("boom");
          },
        },
      },
    ]);
    const entry: Record<string, unknown> = {
      id: "1",
      title: "t",
      hidden: "x",
      broken: "y",
    };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
    });
    expect(entry).toEqual({ id: "1", title: "t" });
  });

  it("field hooks transform values in phase order", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "slugish",
        type: "text",
        hooks: {
          beforeChange: [
            ({ value }: { value: unknown }) => String(value).toLowerCase(),
            ({ value }: { value: unknown }) =>
              String(value).replace(/\s+/g, "-"),
          ],
        },
      },
    ]);
    const data: Record<string, unknown> = { slugish: "Hello World" };
    await runFieldHooks({
      kind: "collection",
      slug: "posts",
      phase: "beforeChange",
      data,
      operation: "create",
    });
    expect(data.slugish).toBe("hello-world");
  });

  it("attachFieldValidators makes registered custom validate run in the entry validator", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "code",
        type: "text",
        validate: (value: unknown) =>
          typeof value === "string" && value.startsWith("X")
            ? true
            : "Must start with X",
      },
    ]);
    // Serialized field defs carry no functions — exactly the registry's
    // reason to exist.
    const serializedFields = [{ name: "code", type: "text" }];
    const fields = attachFieldValidators(
      "collection",
      "posts",
      serializedFields
    );
    const issues = await validateEntryData({ code: "nope" }, fields, {
      mode: "create",
    });
    expect(issues).toEqual([
      { path: "code", code: "CUSTOM", message: "Must start with X." },
    ]);
  });
});
