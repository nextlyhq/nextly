/**
 * `parent` is checked at REGISTRATION, not only by the compiler.
 *
 * A bare string is the shape to fear rather than a missing field: it is iterable, so a reader
 * spreading it produces one-character "block names", every real placement is refused as the wrong
 * parent, and documents already using the block stop saving — with nothing in the failure naming
 * this declaration. TypeScript rejects it at the authoring site; definitions also arrive from
 * JavaScript plugins, from JSON, and from builds where the types were never run.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearBlocks, getBlock, registerBlocks } from "./registry";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(() => {
  clearBlocks();
});

describe("parent validation at registration", () => {
  it("accepts an array of namespaced names", () => {
    // The positive control: without it, a gate that refused every `parent` would pass the
    // rejections below while making the field unusable.
    registerBlocks(
      [{ ...base, name: "acme/ok", parent: ["core/columns"] }] as never,
      { source: "acme" }
    );
    expect(getBlock("acme/ok")?.parent).toEqual(["core/columns"]);
  });

  it("accepts a definition that declares no parent at all", () => {
    registerBlocks([{ ...base, name: "acme/none" }] as never, {
      source: "acme",
    });
    expect(getBlock("acme/none")).toBeDefined();
  });

  it("refuses a bare string, which would spread into one-character names", () => {
    expect(() =>
      registerBlocks(
        [{ ...base, name: "acme/str", parent: "core/columns" }] as never,
        { source: "acme" }
      )
    ).toThrow(/parent must be an array/);
  });

  it("refuses an EMPTY list, which permits no placement at all", () => {
    // Easier to write by accident than a malformed one — a list built by filtering, or by a config
    // lookup that matched nothing. Omitting `parent` already expresses "anywhere", so nothing is
    // lost by refusing it.
    expect(() =>
      registerBlocks([{ ...base, name: "acme/empty", parent: [] }] as never, {
        source: "acme",
      })
    ).toThrow(/empty parent list/);
  });

  it("refuses an entry that is not a namespaced block name", () => {
    expect(() =>
      registerBlocks(
        [{ ...base, name: "acme/bad", parent: ["columns"] }] as never,
        { source: "acme" }
      )
    ).toThrow(/parent must be an array/);
  });
});

describe("slot allow-list validation at registration", () => {
  const withSlots = (slots: unknown) => ({ ...base, name: "acme/box", slots });

  it("accepts block names and namespace wildcards", () => {
    // The positive control on BOTH accepted forms: a gate refusing either would pass every
    // rejection below while making the field unusable.
    expect(() =>
      registerBlocks(
        [
          withSlots({ default: { allow: ["core/heading", "acme/*"] } }),
        ] as never,
        { source: "acme" }
      )
    ).not.toThrow();
  });

  it("accepts a slot that restricts nothing", () => {
    expect(() =>
      registerBlocks([withSlots({ default: {} })] as never, { source: "acme" })
    ).not.toThrow();
  });

  it("refuses an allow that is not an array", () => {
    // The shape that reaches a spread as `TypeError: spec.allow is not iterable`, at the first
    // nesting lookup rather than at the declaration.
    expect(() =>
      registerBlocks([withSlots({ default: { allow: 42 } })] as never, {
        source: "acme",
      })
    ).toThrow(/allow must be an array/);
  });

  it("refuses an entry that is neither a name nor a namespace", () => {
    expect(() =>
      registerBlocks(
        [withSlots({ default: { allow: ["heading"] } })] as never,
        {
          source: "acme",
        }
      )
    ).toThrow(/allow must be an array/);
  });

  it("refuses a slot spec that is not an object", () => {
    expect(() =>
      registerBlocks([withSlots({ default: "yes" })] as never, {
        source: "acme",
      })
    ).toThrow(/must be a plain object/);
  });

  it("refuses a slot named for a member Object.prototype owns", () => {
    // The op layer refuses any node carrying such a slot, so a block declaring
    // one offers a palette row whose insert is always refused. With declared
    // starting children that refusal is SILENT — the row is clicked and
    // nothing appears — which is why this is caught at the declaration.
    expect(() =>
      registerBlocks([withSlots({ constructor: {} })] as never, {
        source: "acme",
      })
    ).toThrow(/Object\.prototype owns/);
  });

  it("refuses a __proto__ slot, which fails on the write rather than the read", () => {
    // Built through `JSON.parse` rather than an object literal. A literal
    // `{ __proto__: {} }` invokes the legacy prototype SETTER and creates no
    // own key, so the fixture would carry no slot at all and the assertion
    // would pass without the check ever running — the shape this refuses
    // reaches the engine from stored JSON, where it IS an own key.
    const slots: unknown = JSON.parse('{"__proto__":{}}');
    expect(Object.keys(slots as object)).toEqual(["__proto__"]);

    expect(() =>
      registerBlocks([withSlots(slots as never)] as never, { source: "acme" })
    ).toThrow(/Object\.prototype owns/);
  });

  it("accepts an ordinary slot name", () => {
    // The control. A predicate that refused every name would satisfy both
    // assertions above while making the engine unusable.
    expect(() =>
      registerBlocks([withSlots({ children: {} })] as never, { source: "acme" })
    ).not.toThrow();
  });

  it("refuses a defaultBlock that is not an array", () => {
    // The shape that reaches the expansion's `for...of` as
    // `TypeError: declared is not iterable` — at the author's CLICK on the
    // block rather than at the declaration, naming neither the plugin nor the
    // block that caused it.
    expect(() =>
      registerBlocks(
        [withSlots({ default: { defaultBlock: "core/column" } })] as never,
        { source: "acme" }
      )
    ).toThrow(/defaultBlock must be an array/);
  });

  it("refuses a defaultBlock entry that is not an object", () => {
    // A bare string is iterable, so a reader spreading it produces
    // one-character values rather than failing — the entry has to be a record
    // before anything reads `type` off it.
    expect(() =>
      registerBlocks(
        [withSlots({ default: { defaultBlock: ["core/column"] } })] as never,
        { source: "acme" }
      )
    ).toThrow(/defaultBlock must be an array/);
  });

  it("refuses a defaultBlock entry whose type is not a block name", () => {
    // Expansion resolves the entry BY type. A name the grammar rejects can
    // never resolve, so the child is silently dropped and the container
    // arrives empty with nothing reported.
    expect(() =>
      registerBlocks(
        [
          withSlots({ default: { defaultBlock: [{ type: "column" }] } }),
        ] as never,
        { source: "acme" }
      )
    ).toThrow(/defaultBlock must be an array/);
  });

  it("refuses a defaultBlock entry whose props are not a plain object", () => {
    // Props are spread into the child. A non-record spreads to nothing, so the
    // declaration registers and the child arrives without the values it names.
    expect(() =>
      registerBlocks(
        [
          withSlots({
            default: { defaultBlock: [{ type: "core/column", props: 7 }] },
          }),
        ] as never,
        { source: "acme" }
      )
    ).toThrow(/defaultBlock must be an array/);
  });

  it("refuses defaultBlock props that are an exotic object", () => {
    // A `Date`, `Map` or class instance is an object and not an array, so a
    // predicate testing only those two accepts it. Expansion then spreads it
    // into `{}` and the child arrives with NONE of the declared props, having
    // registered without complaint. The prototype is what separates them.
    expect(() =>
      registerBlocks(
        [
          withSlots({
            default: {
              defaultBlock: [{ type: "core/column", props: new Date() }],
            },
          }),
        ] as never,
        { source: "acme" }
      )
    ).toThrow(/defaultBlock must be an array/);
  });

  it("accepts a defaultBlock entry that names only a type", () => {
    // `props` is optional and the child's own defaults stand underneath it, so
    // an entry naming just a type is the ordinary case. A validator that
    // required `props` would refuse every first-party declaration.
    expect(() =>
      registerBlocks(
        [
          withSlots({ default: { defaultBlock: [{ type: "core/column" }] } }),
        ] as never,
        { source: "acme" }
      )
    ).not.toThrow();
  });
});
