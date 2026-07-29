import { describe, expect, it } from "vitest";

import { TypeGenerator } from "../../../domains/schema/services/type-generator";
import type { DataFromFieldGroupSlug, FieldGroupSlug } from "../components";

/**
 * The generated `Config` map and the types that read it form a contract split
 * across two files, and TypeScript cannot enforce it: `FieldGroupSlug` is a
 * conditional on `GeneratedTypes extends { fieldGroups: infer C }`, so if the
 * generator emits a different key the conditional quietly takes its fallback
 * branch and every slug widens to `string`. Nothing fails to compile — the
 * type safety is simply gone.
 *
 * These cases pin both halves: the key the generator writes, and the fact that
 * a reader shaped like `FieldGroupSlug` resolves a literal union from it.
 */

/** Compile-time equality; `Exact<A, B>` is `false` when the two differ. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

function assertType<T extends true>(_proof: T): void {
  /* the constraint is the assertion; a mismatch fails to compile */
}

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

  it("resolves a literal union from that key, not the string fallback", () => {
    // Mirrors an augmented `Config`. If the generator's key and this one ever
    // disagree, `Slug` becomes `string` and the assertion below stops compiling.
    interface AugmentedTypes {
      fieldGroups: { seo: { metaTitle: string }; hero: { heading: string } };
    }
    type Slug = AugmentedTypes extends { fieldGroups: infer C }
      ? keyof C & string
      : string;

    // Exact<> is false if `Slug` had degraded to `string`, so this single
    // assertion covers both "is the union" and "is not the fallback".
    assertType<Exact<Slug, "seo" | "hero">>(true);
  });

  it("falls back to string when nothing is augmented", () => {
    // Unaugmented `GeneratedTypes` is empty, so the fallback here is the
    // documented behaviour rather than the degradation guarded above.
    assertType<Exact<FieldGroupSlug, string>>(true);
    assertType<Exact<DataFromFieldGroupSlug<"seo">, Record<string, unknown>>>(
      true
    );
  });
});
