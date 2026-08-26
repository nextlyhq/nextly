/**
 * The one question both registries ask: does this code-first config differ from
 * its stored row in a way that has to be written through the SCHEMA path.
 *
 * Tested here rather than through either registry because it is shared. Proving
 * it through the Single registry alone would leave the collection registry's
 * use of it unproven, and the failure that matters is precisely the one where
 * the two domains stop agreeing.
 *
 * Every case below is a single field differing with everything else held equal,
 * because the defect this guards against is a clause going missing: a condition
 * that dropped one comparison would still pass a test that changed two things.
 */
import { describe, expect, it } from "vitest";

import {
  BaseRegistryService,
  type SchemaSyncSubject,
} from "../base-registry-service";

/**
 * A concrete registry with nothing in it, so the shared predicate can be asked
 * directly rather than through a domain's mocking apparatus.
 */
class ProbeRegistry extends BaseRegistryService<never> {
  protected readonly registryTableName = "probe";
  protected readonly resourceType = "Probe";
  protected readonly tableNamePrefix = "probe_";
  protected getSearchColumns(): string[] {
    return [];
  }
  protected deserializeRecord(): never {
    throw new Error("not used");
  }

  ask(
    config: SchemaSyncSubject,
    existing: SchemaSyncSubject,
    schemaHashChanged: boolean
  ): boolean {
    return this.schemaSyncNeeded(config, existing, schemaHashChanged);
  }
}

const probe = new ProbeRegistry(
  null as never,
  { debug() {}, info() {}, warn() {}, error() {} } as never
);

/** Everything equal, so each case below differs in exactly one field. */
const same: SchemaSyncSubject = {
  status: true,
  localized: false,
  versions: { drafts: true },
  revalidate: { seconds: 60 },
  webhooks: { record: false },
};

describe("BaseRegistryService.schemaSyncNeeded", () => {
  it("answers no when nothing differs and the hash matched", () => {
    // The control. Without it, a predicate hard-wired to `true` would satisfy
    // every other case here.
    expect(probe.ask(same, { ...same }, false)).toBe(false);
  });

  it("answers yes when the caller reports a changed schema hash", () => {
    // The hash is compared by the caller, so this is the whole of what this
    // predicate does with it — and the case that must survive the comparison
    // living outside.
    expect(probe.ask(same, { ...same }, true)).toBe(true);
  });

  it("answers yes when the status toggle flipped", () => {
    // Adds or removes a physical column, which is why it belongs on this path.
    expect(probe.ask({ ...same, status: false }, same, false)).toBe(true);
  });

  it("answers yes when the versioning config changed", () => {
    expect(
      probe.ask({ ...same, versions: { drafts: false } }, same, false)
    ).toBe(true);
  });

  it("answers yes when the revalidation config changed", () => {
    expect(
      probe.ask({ ...same, revalidate: { seconds: 30 } }, same, false)
    ).toBe(true);
  });

  it("answers yes when the webhook policy changed", () => {
    expect(
      probe.ask({ ...same, webhooks: { record: true } }, same, false)
    ).toBe(true);
  });

  it("answers yes when localization was turned on", () => {
    expect(probe.ask({ ...same, localized: true }, same, false)).toBe(true);
  });

  it("reads absent and null as the same thing", () => {
    /*
     * A stored column with no value arrives as `null`; a config that declares
     * none has `undefined`. They mean the same thing, so a comparison that told
     * them apart would report a change on every boot — a write per startup,
     * per resource, that nothing else here would report.
     */
    const declared: SchemaSyncSubject = { status: false, localized: false };
    const stored: SchemaSyncSubject = {
      status: false,
      localized: false,
      versions: null,
      revalidate: null,
      webhooks: null,
    };

    expect(probe.ask(declared, stored, false)).toBe(false);
  });

  it("reads two orderings of the same object as the same value", () => {
    /*
     * Postgres stores these columns as `jsonb`, which does not preserve the key
     * order it was given — it normalises them — so the row read back can spell
     * the same value differently from the config that wrote it. A plain
     * `JSON.stringify` compare would then report a change on every startup, for
     * every resource, on that adapter only: a write per boot, and `updated_at`
     * churning, with every instrument reporting the sync as legitimate work.
     *
     * The comparison is therefore over a canonical form. Arrays keep their
     * order, because order is part of an array's value.
     */
    const declared: SchemaSyncSubject = {
      status: true,
      localized: false,
      versions: { drafts: true, max: 10, nested: { a: 1, b: 2 } },
    };
    const storedDifferentOrder: SchemaSyncSubject = {
      status: true,
      localized: false,
      versions: { nested: { b: 2, a: 1 }, max: 10, drafts: true },
    };

    expect(probe.ask(declared, storedDifferentOrder, false)).toBe(false);
  });

  it("sees a difference that lives under `__proto__`", () => {
    /*
     * `JSON.parse` creates `__proto__` as an ORDINARY own key, so a stored
     * `jsonb` column round-tripping through it reaches here carrying one. The
     * canonical rebuild then has to keep it — assigning that key to a plain
     * `{}` invokes the legacy prototype setter instead of creating an
     * enumerable property, `JSON.stringify` omits it, and two configs
     * differing only there compare EQUAL. A null-prototype target is what makes
     * the key survive.
     *
     * The failure is quiet in exactly the wrong direction: a real edit reads as
     * "unchanged" and never reaches storage.
     */
    const declared = JSON.parse(
      '{"drafts":true,"__proto__":{"max":10}}'
    ) as SchemaSyncSubject["versions"];
    const stored = JSON.parse(
      '{"drafts":true}'
    ) as SchemaSyncSubject["versions"];

    expect(
      probe.ask(
        { ...same, versions: declared },
        { ...same, versions: stored },
        false
      )
    ).toBe(true);
  });

  it("does not let a canonicalised value pollute Object.prototype", () => {
    // The neighbouring risk in the same key. Nothing here writes through a
    // prototype setter, and this is what would notice if that changed.
    const declared = JSON.parse('{"__proto__":{"polluted":"yes"}}');
    probe.ask({ ...same, versions: declared }, { ...same }, false);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("still sees a REORDERED ARRAY as a change", () => {
    // The control on the case above. Canonicalising keys must not extend to
    // sorting array members: `[a, b]` and `[b, a]` are different values, and a
    // comparison that flattened that would stop detecting a real edit.
    expect(
      probe.ask(
        { ...same, versions: { order: ["a", "b"] } },
        { ...same, versions: { order: ["b", "a"] } },
        false
      )
    ).toBe(true);
  });

  it("does not consult naming, which moves no column", () => {
    /*
     * The separating property against the defect this whole change came from.
     * A label or an admin block is metadata: routing it through this path would
     * flag a migration for an edit that touches no column, so those are asked
     * about by their own branch and must not register here.
     */
    const renamed = { ...same, label: "New name", admin: { group: "Content" } };
    const stored = { ...same, label: "Old name", admin: { group: "Settings" } };

    expect(probe.ask(renamed, stored, false)).toBe(false);
  });
});
