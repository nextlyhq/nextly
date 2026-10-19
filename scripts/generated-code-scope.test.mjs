/**
 * Which changes run the generated-code compile check. The set is derived from
 * the generators' imports, so these cases pin what that derivation has to
 * reach and what it must leave out.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  entries,
  extras,
  importClosure,
  inertPattern,
} from "./generated-code-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inert = new RegExp(inertPattern());
const src = "packages/nextly/src/domains/schema/services";

describe("generated-code compile check: what runs it", () => {
  it("runs for a helper the generators import, though nothing lists it by name", () => {
    expect(inert.test(`${src}/field-nullability.ts`)).toBe(false);
    expect(inert.test(`${src}/plugin-codegen.ts`)).toBe(false);
    expect(inert.test(`${src}/generated-lifecycle.ts`)).toBe(false);
  });

  it("runs for the generators, the paths they write to and the config defaults", () => {
    expect(inert.test(`${src}/type-generator.ts`)).toBe(false);
    expect(
      inert.test("packages/nextly/src/shared/lib/generated-output-paths.ts")
    ).toBe(false);
    expect(inert.test("packages/nextly/src/shared/types/config.ts")).toBe(
      false
    );
  });

  it("follows value imports only: a file imported for its types alone stays inert", () => {
    // The generators import these record types with `import type`, which
    // cannot change what they emit.
    const typesOnly =
      "packages/nextly/src/schemas/dynamic-collections/types.ts";
    expect(existsSync(join(root, typesOnly))).toBe(true);
    expect(importClosure().has(typesOnly)).toBe(false);
    expect(inert.test(typesOnly)).toBe(true);
  });

  it("leaves unrelated packages and the docs inert", () => {
    expect(inert.test("packages/admin/src/main.tsx")).toBe(true);
    expect(inert.test("docs/getting-started/installation.mdx")).toBe(true);
  });

  it("names only paths that exist, so a rename cannot narrow the check unseen", () => {
    for (const path of [...entries, ...extras]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });
});
