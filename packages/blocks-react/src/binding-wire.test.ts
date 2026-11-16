/**
 * Binding sources across the wire: what a server read comes back the same on
 * the canvas, the field shapes of every source the read looked up included.
 */
import { describe, expect, it } from "vitest";

import {
  bindingsFromWire,
  bindingsToWire,
  recordedFieldShapes,
} from "./binding-wire";

describe("binding sources on the wire", () => {
  it("come back as the server read them, through JSON", () => {
    const shapes = recordedFieldShapes(
      new Map([
        ["collection:posts", [{ name: "title", type: "text" }]],
        // A relation a path followed into, looked up by the read.
        ["collection:authors", [{ name: "name", type: "text" }]],
        ["single:banner", undefined],
      ] as const)
    );
    const read = {
      entry: { id: "p1", title: "Draft title", author: { name: "Ada" } },
      entryRef: { collection: "posts" },
      singles: new Map([
        ["home", { id: "s1", headline: "Hello" }],
        ["hidden", null],
      ]),
      site: {
        applicationName: "Acme",
        siteUrl: null,
        logoUrl: null,
        timezone: "Europe/Paris",
      },
      timeZone: "Europe/Paris",
      fieldShapes: shapes,
    } as const;
    const back = bindingsFromWire(
      JSON.parse(JSON.stringify(bindingsToWire(read)))
    );
    expect(back.entry).toEqual(read.entry);
    expect(back.entryRef).toEqual(read.entryRef);
    expect([...(back.singles ?? new Map()).entries()]).toEqual([
      ["home", { id: "s1", headline: "Hello" }],
      ["hidden", null],
    ]);
    expect(back.site).toEqual(read.site);
    expect(back.timeZone).toBe("Europe/Paris");
    expect(back.fieldShapes?.fieldsOf({ collection: "authors" })).toEqual([
      { name: "name", type: "text" },
    ]);
    // Unknown stays unknown: its bindings are judged by their values.
    expect(back.fieldShapes?.fieldsOf({ single: "banner" })).toBeUndefined();
    expect(back.fieldShapes?.fieldsOf({ collection: "other" })).toBeUndefined();
  });

  it("sends no shapes for a lookup no read recorded", () => {
    const wire = bindingsToWire({
      singles: new Map(),
      fieldShapes: { fieldsOf: () => [{ name: "x", type: "text" }] },
    });
    expect(wire.shapes).toEqual([]);
  });
});
