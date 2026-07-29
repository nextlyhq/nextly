import { describe, expect, it } from "vitest";

import { TypeGenerator } from "../../../domains/schema/services/type-generator";
/**
 * The generated `Config` map and the types that read it form a contract split
 * across two files, and TypeScript cannot enforce it: `FieldGroupSlug` is a
 * conditional on `GeneratedTypes extends { fieldGroups: infer C }`, so if the
 * generator emits a different key the conditional quietly takes its fallback
 * branch and every slug widens to `string`. Nothing fails to compile — the
 * type safety is simply gone.
 *
 * This file pins the half that can be checked at runtime: the key and interface
 * names the generator actually writes. The compile-time half — that the exported
 * aliases read that same key — lives in `../field-group-slug.test-d.ts`, because
 * tsconfig excludes `*.test.ts` and type assertions here would never be checked.
 */

const fieldGroup = (slug: string) =>
  ({ slug, label: slug, fields: [] }) as never;

describe("generated Config contract", () => {
  it("emits the key the Direct API slug types read", () => {
    const { code } = new TypeGenerator().generateTypesFile(
      [],
      [],
      [fieldGroup("seo"), fieldGroup("hero")]
    );

    // The literal key, not a paraphrase: `FieldGroupSlug` matches on it exactly.
    expect(code).toContain("fieldGroups: {");
    expect(code).toContain('"seo": SeoFieldGroup;');
    expect(code).toContain('"hero": HeroFieldGroup;');
  });

  it("names generated interfaces with the FieldGroup suffix", () => {
    const { code } = new TypeGenerator().generateTypesFile(
      [],
      [],
      [fieldGroup("seo")]
    );

    expect(code).toContain("export interface SeoFieldGroup");
    expect(code).not.toContain("SeoComponent");
  });
});
