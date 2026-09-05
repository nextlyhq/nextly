/**
 * The one rule for what happens to a copied node's link targets.
 *
 * Tested here as a unit as well as through the copiers, because the walk has
 * limits of its own and reaching them through `reidForestWithMap` is not
 * possible: `structuredClone` gives up first, at a shallower depth. Measured on
 * node 22 — `structuredClone` throws `RangeError` between 1,000 and 2,000
 * levels of nesting, while a `JSON` round-trip survives past 5,000. That is a
 * pre-existing ceiling in the copier and not this module's, but it does mean a
 * depth test written against the copier measures the clone, not the scan.
 */
import { describe, expect, it } from "vitest";

import {
  FRAGMENT_REFERENCE_PROPS,
  remapFragmentBindings,
  remapFragmentProps,
} from "./fragment-refs";

const domIds = new Map([["pricing", "pricing-abc12345"]]);
const target = "#pricing-abc12345";

describe("which values are rewritten", () => {
  it("rewrites a link target and leaves display text holding the same string", () => {
    const out = remapFragmentProps(
      { href: "#pricing", text: "#pricing" },
      domIds
    ) as Record<string, string>;

    expect(out.href).toBe(target);
    expect(out.text).toBe("#pricing");
  });

  it("names both target fields the shipped blocks use", () => {
    expect([...FRAGMENT_REFERENCE_PROPS].sort()).toEqual(["href", "url"]);
  });

  it("leaves a fragment addressing something outside the copy alone", () => {
    const out = remapFragmentProps({ href: "#elsewhere" }, domIds) as Record<
      string,
      string
    >;

    expect(out.href).toBe("#elsewhere");
  });

  it("returns the very same value when nothing matched", () => {
    const props = { href: "#elsewhere", text: "plain" };

    expect(remapFragmentProps(props, domIds)).toBe(props);
  });
});

describe("the walk has no limit of its own", () => {
  it("REACHES A LINK DEEPER THAN THE CALL STACK", () => {
    // Roughly three thousand nested records is tens of kilobytes, inside the
    // document byte limit, and overflowed the recursive walk with a RangeError.
    // Depth is a property of authored content, not something this may refuse.
    let deep: Record<string, unknown> = { href: "#pricing" };
    for (let i = 0; i < 20_000; i += 1) deep = { nested: deep };

    let walk = remapFragmentProps(deep, domIds) as Record<string, unknown>;
    while (walk.nested !== undefined) {
      walk = walk.nested as Record<string, unknown>;
    }

    expect(walk.href).toBe(target);
  });

  it("REACHES A LINK IN A RECORD WIDER THAN THE ENVELOPE BUDGET", () => {
    // The component-envelope key budget was borrowed for opaque prop records,
    // which the format does not cap. Past it the record came back untouched and
    // counted as done — a bound that means "refuse this" in one place and
    // "nothing to do" in the other.
    const wide: Record<string, unknown> = { href: "#pricing" };
    for (let i = 0; i < 5_000; i += 1) wide[`filler${i}`] = i;

    const out = remapFragmentProps(wide, domIds) as Record<string, unknown>;

    expect(out.href).toBe(target);
  });
});

describe("a graph comes out a graph", () => {
  it("closes a cycle on the REPLACEMENT, carrying the rewrite with it", () => {
    const cyclic: Record<string, unknown> = { href: "#pricing" };
    cyclic.self = cyclic;

    const out = remapFragmentProps(cyclic, domIds) as Record<string, unknown>;

    expect(out.href).toBe(target);
    expect(out.self).toBe(out);
    expect((out.self as Record<string, unknown>).href).toBe(target);
  });

  it("rebuilds a record reached twice exactly once", () => {
    const shared: Record<string, unknown> = { href: "#pricing" };

    const out = remapFragmentProps({ a: shared, b: shared }, domIds) as Record<
      string,
      unknown
    >;

    expect(out.a).toBe(out.b);
  });

  it("survives a cycle through an ARRAY as well as a record", () => {
    const list: unknown[] = [{ href: "#pricing" }];
    list.push(list);

    const out = remapFragmentProps({ list }, domIds) as { list: unknown[] };

    expect((out.list[0] as Record<string, string>).href).toBe(target);
    expect(out.list[1]).toBe(out.list);
  });
});

describe("bound link targets", () => {
  it("remaps the fallback of a bound target field", () => {
    const out = remapFragmentBindings(
      { href: { $bind: "cta", fallback: "#pricing" } },
      domIds
    ) as Record<string, { fallback: string }>;

    expect(out.href!.fallback).toBe(target);
  });

  it("leaves a bound field that holds no target alone", () => {
    const bindings = { text: { $bind: "title", fallback: "#pricing" } };

    expect(remapFragmentBindings(bindings, domIds)).toBe(bindings);
  });
});
