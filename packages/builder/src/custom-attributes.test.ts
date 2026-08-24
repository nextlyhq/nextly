/**
 * What the attributes editor accepts, and what it refuses to accept silently.
 *
 * The security decision is NOT here: `blocks-react` owns the render-safe set
 * and is tested there. What is only true here is that the editor asks that same
 * question rather than keeping a second copy — so these tests drive the real
 * predicate through the real export, and a divergence between the two shows up
 * as a failure rather than as an attribute that saves and never renders.
 *
 * @module custom-attributes.test
 */
import {
  createBlockResolver,
  isAllowedAttribute,
} from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import {
  attributeKey,
  domIdsTaken,
  htmlUpdate,
  problemMessage,
  rowProblem,
  rowsOf,
  rowProblems,
  storedAttributes,
  type AttributeRow,
} from "./custom-attributes";

const row = (name: string, value = "x"): AttributeRow => ({ name, value });

describe("the editor asks the renderer, and does not restate it", () => {
  it("accepts exactly what the renderer accepts", () => {
    /*
     * Driven through the RENDERER's own predicate rather than a list written
     * here. A list would pass on the day it was written and drift afterwards,
     * which is the failure this arrangement exists to prevent — and it would
     * drift silently, because the editor is where an author is told and the
     * renderer is where the value is dropped.
     */
    for (const name of [
      "data-analytics",
      "aria-label",
      "role",
      "title",
      "lang",
      "dir",
      "onclick",
      "href",
      "src",
      "style",
      "class",
      "srcdoc",
    ]) {
      const refused = rowProblem([row(name)], 0) !== undefined;
      expect(refused, name).toBe(!isAllowedAttribute(name));
    }
  });

  it("refuses `id` even though the renderer allows it", () => {
    // A deliberate editor narrowing, like the canvas markers: there is a
    // field for an id above, and offering two routes to one identifier is
    // the "two spellings of one question" problem wearing a UI. Asserted
    // here so its absence from the loop above reads as a decision.
    expect(isAllowedAttribute("id")).toBe(true);
    expect(rowProblem([row("id")], 0)).toEqual({
      kind: "use-css-id-field",
    });
  });

  it("has something to test", () => {
    // The control on the loop above: if the predicate accepted everything, or
    // refused everything, that assertion would hold vacuously.
    expect(isAllowedAttribute("data-x")).toBe(true);
    expect(isAllowedAttribute("onclick")).toBe(false);
  });
});

describe("two rows that are one attribute", () => {
  it("treats names differing only in capitals as the same", () => {
    // HTML attribute names are ASCII case-insensitive and the renderer
    // lowercases before writing, so these are one attribute on the page.
    expect(attributeKey("Data-X")).toBe(attributeKey("data-x"));
    const rows = [row("data-x", "first"), row("Data-X", "second")];
    expect(rowProblem(rows, 0)).toBeUndefined();
    expect(rowProblem(rows, 1)).toEqual({
      kind: "duplicate",
    });
  });

  it("reports the LOSING row, not both", () => {
    // Reporting both would leave an author with two errors and no indication
    // which value survives; the first is the one the renderer keeps.
    const rows = [row("data-x"), row("data-x")];
    const reported = rows.filter(
      (_each, index) => rowProblem(rows, index) !== undefined
    );
    expect(reported).toHaveLength(1);
  });
});

describe("an id in the bag, with a field for it above", () => {
  it("always points the author at the field", () => {
    /*
     * The renderer resolves this in favour of `cssId` and says so: the modelled
     * field wins over an attribute of the same name. That is the right
     * precedence and it is invisible from the editor — without this an author
     * types an id, sees it saved, and the page carries a different one.
     */
    const rows = [row("id", "from-the-bag")];
    expect(rowProblem(rows, 0)).toEqual({
      kind: "use-css-id-field",
    });
    // And with no CSS id set either: one route to an identifier, not two.
    expect(rowProblem(rows, 0)).toEqual({ kind: "use-css-id-field" });
  });

  it("still allows every OTHER name", () => {
    // The control: the rule is about `id` alone, not about the bag.
    expect(rowProblem([row("data-x")], 0)).toBeUndefined();
    expect(rowProblem([row("title")], 0)).toBeUndefined();
  });
});

describe("what gets stored", () => {
  it("drops rows that would not reach the page", () => {
    // Storing a value the page never uses is the silent half of the problem
    // this surface exists to make loud.
    const rows = [row("data-keep", "yes"), row("onclick", "no"), row("")];
    expect(storedAttributes(rows, "")).toEqual({ "data-keep": "yes" });
  });

  it("stores NOTHING rather than an empty bag", () => {
    // So removing the last attribute leaves the node as it was before any were
    // added, rather than carrying an empty record forever.
    expect(storedAttributes([row("")], "")).toBeUndefined();
    expect(storedAttributes([], "")).toBeUndefined();
  });

  it("lowercases the stored name, as the renderer will", () => {
    expect(storedAttributes([row("Data-X", "v")], "")).toEqual({
      "data-x": "v",
    });
  });

  it("round-trips what it stored", () => {
    // The property an author actually feels: what they typed comes back.
    const rows = [row("data-b", "two"), row("data-a", "one")];
    const stored = storedAttributes(rows, "");
    expect(rowsOf(stored)).toEqual([
      { name: "data-a", value: "one", origin: "data-a" },
      { name: "data-b", value: "two", origin: "data-b" },
    ]);
  });
});

describe("what the author is told", () => {
  it("names the open prefixes rather than only refusing", () => {
    // A refusal that does not say what IS allowed leaves an author guessing at
    // an allowlist they cannot see.
    const said = problemMessage({ kind: "not-allowed" });
    expect(said).toContain("data-");
    expect(said).toContain("aria-");
  });

  it("tells the author where an id belongs", () => {
    expect(problemMessage({ kind: "use-css-id-field" })).toContain("CSS id");
  });
});

describe("names the editor needs for itself", () => {
  it("refuses the canvas markers, which the RENDERER has no reason to refuse", () => {
    /*
     * Both are `data-` attributes, so the render-safe rule admits them — rightly,
     * because on a published page they are ordinary author data. They are not
     * ordinary in the editor: the canvas reads one to decide which block was
     * clicked and treats the other as its own chrome, so a block carrying
     * either sends a click to the wrong block or swallows it.
     */
    for (const name of ["data-nx-node", "data-nx-prop", "data-nx-chrome"]) {
      // The control: the renderer DOES allow it, so this refusal is the
      // editor's own narrowing rather than the shared rule showing through.
      expect(isAllowedAttribute(name), name).toBe(true);
      expect(rowProblem([row(name)], 0), name).toEqual({
        kind: "reserved",
      });
    }
  });

  it("reserves the whole namespace, not just the markers that exist", () => {
    /*
     * A prefix rather than a list. The list version fell behind once already
     * — three markers existed and two were reserved — and a marker a future
     * overlay needs is covered here without anyone remembering to add it.
     */
    expect(rowProblem([row("data-nx-anything")], 0)).toEqual({
      kind: "reserved",
    });
  });

  it("still allows an ordinary data attribute", () => {
    // The control that stops the reservation swallowing the namespace it sits
    // in: `data-` is the feature and only `data-nx-` is spoken for.
    expect(rowProblem([row("data-analytics")], 0)).toBeUndefined();
    expect(rowProblem([row("data-nxt")], 0)).toBeUndefined();
  });
});

/*
 * Every fixture node in this file is `acme/x` at version 1 and renders its own
 * markup, so the id scan reaches all of them. The placeholder cases below say
 * so by naming a node this resolver does NOT know.
 */
const renders = createBlockResolver([{ name: "acme/x", version: 1 } as never]);

describe("which ids a document already holds", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("reads BOTH the modelled field and the attribute bag", () => {
    // They become the same page-wide identifier, so a check reading one of them
    // would let the other collide silently.
    const taken = domIdsTaken(
      [
        node({ id: "b", cssId: "from-field" }),
        node({ id: "c", attributes: { id: "from-bag" } }),
      ],
      "a",
      renders
    );
    expect([...taken].sort()).toEqual(["from-bag", "from-field"]);
  });

  it("skips the node being edited, and descends into slots", () => {
    const taken = domIdsTaken(
      [
        node({ id: "a", cssId: "mine" }),
        node({
          id: "b",
          slots: { main: [node({ id: "d", cssId: "nested" })] },
        }),
      ],
      "a",
      renders
    );
    // Its own id is not a collision with itself.
    expect(taken.has("mine")).toBe(false);
    // And a block inside a slot is still on the page.
    expect(taken.has("nested")).toBe(true);
  });
});

describe("the op that stores the two fields", () => {
  const fields = (
    cssId: string | undefined,
    attributes?: Record<string, string>
  ): {
    cssId: string | undefined;
    attributes: Record<string, string> | undefined;
  } => ({
    cssId,
    attributes,
  });

  it("says nothing when nothing changed", () => {
    // An op that rewrites a value to itself is an undo entry that undoes
    // nothing, and an author pressing undo gets a step that does nothing.
    expect(
      htmlUpdate(fields("hero", { a: "1" }), fields("hero", { a: "1" }))
    ).toBeUndefined();
    expect(htmlUpdate(fields(""), fields(""))).toBeUndefined();
  });

  it("UNSETS rather than patching undefined", () => {
    /*
     * `applyOp` refuses `undefined` as a patch value and says why: the key
     * disappears when the op is stored, so a replayed edit would do nothing.
     *
     * Removal is `undefined`, not `""`. The two are different requests — see
     * the test below — and this one asks for the field to be GONE.
     */
    expect(htmlUpdate(fields(undefined), fields("hero"))).toEqual({
      patch: {},
      unset: ["cssId"],
    });
    expect(htmlUpdate(fields("hero"), fields("hero", { a: "1" }))).toEqual({
      patch: {},
      unset: ["attributes"],
    });
  });

  it("keeps an EMPTY id distinct from an absent one", () => {
    /*
     * A third state, and the renderer reads it: it writes `extra.id = cssId`
     * on `cssId !== undefined`, so a stored `""` renders `id=""` and shadows
     * any `id` in the bag. Asking for one is therefore a patch, not an unset,
     * and asking to remove one is an unset even though the box looks the same.
     */
    expect(htmlUpdate(fields(""), fields("hero"))).toEqual({
      patch: { cssId: "" },
      unset: [],
    });
    expect(htmlUpdate(fields(undefined), fields(""))).toEqual({
      patch: {},
      unset: ["cssId"],
    });
    // And neither is a change from itself.
    expect(htmlUpdate(fields(""), fields(""))).toBeUndefined();
    expect(htmlUpdate(fields(undefined), fields(undefined))).toBeUndefined();
  });

  it("does not unset a field the node never had", () => {
    // Setting an id on a block with no attributes must not carry an instruction
    // to remove attributes it does not have.
    expect(htmlUpdate(fields("hero"), fields(""))).toEqual({
      patch: { cssId: "hero" },
      unset: [],
    });
  });

  it("writes both when both changed", () => {
    expect(htmlUpdate(fields("hero", { a: "1" }), fields("old"))).toEqual({
      patch: { cssId: "hero", attributes: { a: "1" } },
      unset: [],
    });
  });
});

describe("an id spelled with capitals in the bag", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("counts as taken, because the renderer lowercases it", () => {
    /*
     * A stored `{ ID: "hero" }` renders as `id="hero"` — HTML attribute names
     * are ASCII case-insensitive and the renderer lowercases every key before
     * writing. A scan reading only the exact key `id` misses it, and another
     * block is then allowed to take the same id.
     */
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { ID: "hero" } })],
      "a",
      renders
    );
    expect(taken.has("hero")).toBe(true);
  });

  it("takes the LAST spelling, as the renderer's own loop does", () => {
    // It assigns each lowercased key in turn, so a later one replaces an
    // earlier one. This editor never writes two spellings; an import can.
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { ID: "first", id: "second" } })],
      "a",
      renders
    );
    expect(taken.has("second")).toBe(true);
    expect(taken.has("first")).toBe(false);
  });
});

describe("a name inside an open prefix that HTML cannot carry", () => {
  it("refuses it, because the page would carry nothing", () => {
    /*
     * `data-x foo` starts with `data-` and is not an attribute name. React
     * refuses it and renders nothing, so a check stopping at the prefix let a
     * value be stored that could never appear — the saved-but-absent failure
     * this whole surface exists to prevent.
     */
    for (const name of ["data-x foo", 'data-x"', "data-x=y", "aria-a<b"]) {
      expect(isAllowedAttribute(name), name).toBe(false);
      expect(rowProblem([row(name)], 0), name).toEqual({
        kind: "not-allowed",
      });
    }
  });

  it("still accepts names the DOM does carry, including non-ASCII", () => {
    // The control, and the reason the rule mirrors React's own production
    // rather than a narrower one: refusing a name that WOULD render is a false
    // alarm on correct input.
    for (const name of ["data-x", "aria-label", "data-æøå", "data-x1"]) {
      expect(isAllowedAttribute(name), name).toBe(true);
    }
  });
});

describe("a row that cannot land keeps what it replaced", () => {
  const stored = { "data-x": "1", "data-y": "2" };

  it("does not delete the attribute behind a mistyped rename", () => {
    // Renaming means the author typed something wrong, not that they want the
    // old attribute gone.
    const rows = [
      { name: "onclick", value: "1", origin: "data-x" },
      { name: "data-y", value: "2", origin: "data-y" },
    ];
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
  });

  it("still removes a DIFFERENT row while one is mistyped", () => {
    /*
     * The interaction that an earlier design got wrong: holding the whole write
     * for a mistyped row meant clicking Remove on an unrelated row did nothing,
     * and the attribute came back when the panel was reopened.
     */
    const rows = [{ name: "onclick", value: "1", origin: "data-x" }];
    expect(storedAttributes(rows, "", stored)).toEqual({ "data-x": "1" });
  });

  it("writes nothing for a mistyped row the author ADDED", () => {
    // Nothing to keep: it never had a stored value behind it.
    expect(
      storedAttributes([{ name: "onclick", value: "1" }], "", stored)
    ).toBeUndefined();
  });
});

describe("the id a node actually renders", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("treats an EMPTY modelled id as present, as the renderer does", () => {
    /*
     * The renderer writes `extra.id = cssId` whenever `cssId !== undefined`, so
     * an empty one still overwrites the bag and the element renders `id=""`.
     * Reading it as absent recorded the bag's value and refused another block an
     * id that never appears on the page.
     */
    const taken = domIdsTaken(
      [node({ id: "b", cssId: "", attributes: { id: "hero" } })],
      "a",
      renders
    );
    expect(taken.has("hero")).toBe(false);
    // And the empty one takes nothing: it is not an id, it only stops the bag.
    expect(taken.has("")).toBe(false);
  });

  it("still takes the bag id when there is no modelled field at all", () => {
    // The control: the rule is about PRESENCE, not about emptiness in general.
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { id: "hero" } })],
      "a",
      renders
    );
    expect(taken.has("hero")).toBe(true);
  });

  it("survives a malformed SLOTS map, and a null inside one", () => {
    /*
     * Two more shapes a stored document can hold, and neither is the attribute
     * bag: `Object.values(null)` throws on a null `slots`, and a null sitting
     * inside a slot array reaches the walk itself, which reads `.id` off it.
     * Guarding only the first — the obvious one — leaves the second, so the
     * check lives at the single point every node passes through.
     */
    expect(() =>
      domIdsTaken(
        [
          node({ id: "b", slots: null }),
          node({ id: "c", slots: { main: [null, "nope"] } }),
          node({ id: "d", cssId: "kept" }),
        ],
        "a",
        renders
      )
    ).not.toThrow();
    // And a real nested node beside the rubbish is still read, so the guard
    // skips rather than abandoning the walk.
    const taken = domIdsTaken(
      [
        node({
          id: "b",
          slots: { main: [null, node({ id: "e", cssId: "nested" })] },
        }),
      ],
      "a",
      renders
    );
    expect(taken.has("nested")).toBe(true);
  });

  it("survives a malformed bag on another node", () => {
    /*
     * This walks every OTHER node, and a stored document holds whatever the
     * database returned. `Object.entries(null)` throws, and one bad node
     * elsewhere took the whole tab down before it rendered.
     */
    expect(() =>
      domIdsTaken(
        [
          node({ id: "b", attributes: null }),
          node({ id: "c", attributes: ["nope"] }),
          node({ id: "d", cssId: "kept" }),
        ],
        "a",
        renders
      )
    ).not.toThrow();
    // And the good node beside them is still read, so the guard skips rather
    // than abandoning the walk.
    expect(
      domIdsTaken(
        [node({ id: "b", attributes: null }), node({ id: "d", cssId: "kept" })],
        "a",
        renders
      ).has("kept")
    ).toBe(true);
  });
});

describe("a bag holding two spellings of id", () => {
  it("drops EVERY variant once the field above is set", () => {
    /*
     * The duplicate check runs before the id rule, so the first variant draws
     * `use-css-id-field` and every later one draws `duplicate`. Keying the drop
     * on one kind preserved the second — and clearing the CSS id later made a
     * supposedly removed value render again.
     */
    const bag = { ID: "first", id: "second" };
    expect(storedAttributes(rowsOf(bag), "new", bag)).toBeUndefined();
  });

  it("keeps both when no CSS id is set, rather than deleting silently", () => {
    // The control: with nothing in the field above, the author has not asked
    // for anything to go, so nothing does.
    const bag = { ID: "first", id: "second" };
    expect(storedAttributes(rowsOf(bag), "", bag)).toEqual(bag);
  });
});

describe("renaming a row onto a name another row already holds", () => {
  const stored = { "data-a": "one", "data-b": "two" };

  it("blames the EDITED row, not the untouched one", () => {
    /*
     * First-wins alone got this backwards: the edited row sat earlier, looked
     * fine, and the untouched row was marked the duplicate — so on rebuild the
     * untouched row's old value overwrote the edit and `data-a` disappeared.
     */
    const rows = [
      { name: "data-b", value: "edited", origin: "data-a" },
      { name: "data-b", value: "two", origin: "data-b" },
    ];
    expect(rowProblem(rows, 0)).toEqual({ kind: "duplicate" });
    expect(rowProblem(rows, 1)).toBeUndefined();
    // And nothing is lost: the edited row falls back to what it replaced.
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
  });

  it("still uses first-wins between two rows the DOCUMENT supplied", () => {
    // Neither is the author's doing, so there is no one to blame and the
    // earlier spelling is kept — which is what the renderer does too.
    const bag = { ID: "first", id: "second" };
    const rows = rowsOf(bag);
    expect(rowProblem(rows, 0)).toEqual({ kind: "use-css-id-field" });
    expect(rowProblem(rows, 1)).toEqual({ kind: "duplicate" });
  });
});

describe("the id a bag renders when it holds an empty spelling last", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("takes the LAST variant even when it is empty", () => {
    /*
     * The renderer assigns each lowercased key in turn, so a trailing `ID: ""`
     * leaves the element with `id=""`. Skipping the empty one kept `hero` and
     * refused another block an id that does not render.
     */
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { id: "hero", ID: "" } })],
      "a",
      renders
    );
    expect(taken.has("hero")).toBe(false);
  });

  it("still takes it when the last variant holds something", () => {
    // The control: last-wins, not empty-wins.
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { ID: "", id: "hero" } })],
      "a",
      renders
    );
    expect(taken.has("hero")).toBe(true);
  });
});

describe("an empty bag and no bag", () => {
  it("are the same to `htmlUpdate`, so viewing writes nothing", () => {
    /*
     * The renderer asks `Object.keys(attributes).length > 0`, so `{}` behaves
     * as absent. Treating them as different rewrote a node stored with `{}` the
     * moment anyone opened the tab, putting an edit in the undo history for
     * having looked at a panel.
     */
    expect(
      htmlUpdate(
        { cssId: "", attributes: undefined },
        { cssId: "", attributes: {} }
      )
    ).toBeUndefined();
    expect(
      htmlUpdate(
        { cssId: "", attributes: {} },
        { cssId: "", attributes: undefined }
      )
    ).toBeUndefined();
  });

  it("still notices a bag that actually gained something", () => {
    // The control: the equality must not swallow a real change.
    expect(
      htmlUpdate(
        { cssId: "", attributes: { a: "1" } },
        { cssId: "", attributes: {} }
      )
    ).toEqual({ patch: { attributes: { a: "1" } }, unset: [] });
  });
});

describe("ids on a node the page replaces with a placeholder", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("reserves nothing for a node whose block is unknown", () => {
    /*
     * The renderer emits no modelled id for a placeholder — asserted in
     * `page-renderer.test.tsx`, "does not reserve a dom id for a node that
     * renders a placeholder". Counting one here refuses a healthy block an
     * anchor the rendered page would contain exactly once.
     */
    const taken = domIdsTaken(
      [node({ id: "b", type: "acme/missing", cssId: "hero" })],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("reserves nothing for a node whose migration failed", () => {
    const taken = domIdsTaken(
      [node({ id: "b", cssId: "hero", migrationFailed: true })],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("reserves nothing for a node ahead of its definition", () => {
    // The third of the predicate's three conditions, which a hand-written copy
    // of "unknown or migration-failed" would have missed.
    const taken = domIdsTaken(
      [node({ id: "b", version: 2, cssId: "hero" })],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("reserves nothing INSIDE one either", () => {
    /*
     * The second site. `pruneNodes` drops the whole subtree, so a healthy child
     * of a placeholder never reaches the page and its id is as free as the
     * parent's. Skipping the node while still descending would have fixed one
     * of the two.
     */
    const taken = domIdsTaken(
      [
        node({
          id: "b",
          type: "acme/missing",
          cssId: "outer",
          slots: { children: [node({ id: "c", cssId: "inner" })] },
        }),
      ],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("still reserves ids on the healthy nodes beside it", () => {
    // The control: the skip must not swallow the scan it sits in.
    const taken = domIdsTaken(
      [
        node({ id: "b", type: "acme/missing", cssId: "gone" }),
        node({ id: "c", cssId: "kept" }),
      ],
      "a",
      renders
    );
    expect([...taken]).toEqual(["kept"]);
  });
});

describe("ids on a node the page gates behind a condition", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;
  const gated = { conditions: [[{ field: "tier", op: "eq", value: "pro" }]] };

  it("reserves nothing for a gated node", () => {
    /*
     * `pruneHiddenNodes` removes it before the render and before the style
     * compile, and the gate fails closed because no evaluator exists — so the
     * id is on no page. Refusing it blocks the pattern the feature is for:
     * two variants of one section sharing an anchor, one of them served.
     */
    const taken = domIdsTaken(
      [node({ id: "b", cssId: "hero", visibility: gated })],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("reserves nothing INSIDE one either", () => {
    // The second site: the subtree goes with the node it hung from.
    const taken = domIdsTaken(
      [
        node({
          id: "b",
          cssId: "outer",
          visibility: gated,
          slots: { children: [node({ id: "c", cssId: "inner" })] },
        }),
      ],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("still reserves an id on a node whose gate is EMPTY", () => {
    /*
     * The control, and the boundary the engine draws: an empty condition list
     * is not a restriction, so the node is served and its id is taken. Reading
     * "has a visibility envelope" as gated would free an id that renders.
     */
    const taken = domIdsTaken(
      [node({ id: "b", cssId: "hero", visibility: { conditions: [] } })],
      "a",
      renders
    );
    expect([...taken]).toEqual(["hero"]);
  });
});

describe("a refused rename beside a rename onto its origin", () => {
  const stored = { "data-a": "1", "data-b": "2" };

  it("does not let the accepted row overwrite what the refused one keeps", () => {
    /*
     * `{ "data-a": "1", "data-b": "2" }` with the first row renamed to
     * `onclick` (refused, so it keeps `data-a`) and the second renamed onto
     * `data-a`. The duplicate check saw only ONE live `data-a` and accepted the
     * second row, which then overwrote the value the first was preserving —
     * `{ "data-a": "2" }`, with `data-b` gone and the refused row's promise to
     * keep what it replaced quietly broken.
     */
    const rows = [
      { name: "onclick", value: "1", origin: "data-a" },
      { name: "data-a", value: "2", origin: "data-b" },
    ];
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
  });

  it("says WHY the accepted row will not land", () => {
    // The author has to be told, or the row simply looks fine and does nothing.
    const rows = [
      { name: "onclick", value: "1", origin: "data-a" },
      { name: "data-a", value: "2", origin: "data-b" },
    ];
    expect(rowProblem(rows, 1)).toEqual({ kind: "duplicate" });
  });

  it("still accepts a rename onto a name nothing is holding", () => {
    // The control: the reservation must not swallow ordinary renames.
    const rows = [
      { name: "onclick", value: "1", origin: "data-a" },
      { name: "data-c", value: "2", origin: "data-b" },
    ];
    expect(rowProblem(rows, 1)).toBeUndefined();
    expect(storedAttributes(rows, "", stored)).toEqual({
      "data-a": "1",
      "data-c": "2",
    });
  });

  it("still accepts a rename onto a name another row is VACATING", () => {
    /*
     * The second control, and the one that says only REFUSED rows hold their
     * origins. Both rows here land, so `data-a` is genuinely freed by the first
     * and genuinely taken by the second; treating every row's origin as held
     * would refuse an ordinary pair of renames and look exactly like the fix.
     */
    const rows = [
      { name: "data-c", value: "1", origin: "data-a" },
      { name: "data-a", value: "2", origin: "data-b" },
    ];
    expect(rowProblem(rows, 1)).toBeUndefined();
    expect(storedAttributes(rows, "", stored)).toEqual({
      "data-c": "1",
      "data-a": "2",
    });
  });
});

describe("a DUPLICATE-refused row holding an origin too", () => {
  const stored = { "data-a": "1", "data-b": "2", "data-c": "3" };

  it("counts what a duplicate-refused row preserves, not only a malformed one", () => {
    /*
     * The first origin-reservation fix counted only rows refused on their own
     * terms. A row refused as a DUPLICATE preserves its origin just the same:
     * rename `data-a` onto `data-b` (duplicate, so it keeps `data-a`) and
     * `data-c` onto `data-a`, and the second was accepted and overwrote the
     * preserved value — `data-c` gone.
     */
    const rows = [
      { name: "data-b", value: "1", origin: "data-a" },
      { name: "data-b", value: "2", origin: "data-b" },
      { name: "data-a", value: "3", origin: "data-c" },
    ];
    expect(rowProblem(rows, 2)).toEqual({ kind: "duplicate" });
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
  });

  it("settles a CHAIN of refusals rather than one link of it", () => {
    /*
     * A row refused because of a held origin holds its OWN origin in turn, so
     * the set has to be settled rather than swept once.
     *
     * Ordered so the chain runs BACKWARD through the rows, which is the only
     * arrangement that can tell one sweep from a fixed point: a chain running
     * forward resolves inside a single pass, because the set grows as that pass
     * walks. Here the last row frees nothing until it is reached, and only then
     * does the first row become refused — and only then the second.
     */
    const rows = [
      { name: "data-b", value: "1", origin: "data-a" },
      { name: "data-a", value: "3", origin: "data-c" },
      { name: "onclick", value: "2", origin: "data-b" },
    ];
    expect(rowProblem(rows, 2)).toEqual({ kind: "not-allowed" });
    expect(rowProblem(rows, 0)).toEqual({ kind: "duplicate" });
    expect(rowProblem(rows, 1)).toEqual({ kind: "duplicate" });
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
  });
});

describe("a held origin spelled with capitals", () => {
  it("is matched case-insensitively, as every other key here is", () => {
    /*
     * `{ "DATA-A": "1", "data-b": "2" }` loaded, the first row renamed to the
     * refused `onclick` and the second onto `data-a`. The held set carried the
     * raw `DATA-A` while the check asked for the normalized `data-a`, so the
     * second rename was accepted and both spellings were stored — and the
     * renderer, which lowercases and lets the last one win, would have changed
     * the rendered value while `data-b` disappeared.
     */
    const stored = { "DATA-A": "1", "data-b": "2" };
    const rows = [
      { name: "onclick", value: "1", origin: "DATA-A" },
      { name: "data-a", value: "2", origin: "data-b" },
    ];
    expect(rowProblem(rows, 1)).toEqual({ kind: "duplicate" });
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
  });
});

describe("a bag with a great many rows in it", () => {
  it("is judged without the work growing faster than the bag", () => {
    /*
     * A COMPLEXITY guard rather than a timing assertion: every row's verdict
     * rebuilt the held set, which walked every row, each of which rescanned
     * every row for its key. An imported bag of a few hundred permitted
     * `data-*` entries froze the panel outright, so this fails by not finishing
     * rather than by being slow.
     */
    const size = 600;
    /*
     * A backward chain of refusals, which is what actually costs: the last row
     * is refused on its own terms and holds its origin, refusing the row before
     * it, and so on. Every link needs another pass over the set, so this is the
     * shape where recomputing the analysis per row multiplies.
     *
     * A field of ordinary VALID rows would not have caught it — the fixed point
     * exits after one pass when nothing is refused, and the first version of
     * this test passed against the unfixed code for exactly that reason.
     */
    const rows = [
      ...Array.from({ length: size - 1 }, (_each, at) => ({
        name: `data-${String(at + 1)}`,
        value: String(at),
        origin: `data-${String(at)}`,
      })),
      { name: "onclick", value: "x", origin: `data-${String(size - 1)}` },
    ];
    const stored = Object.fromEntries(rows.map(row => [row.origin, row.value]));

    // Every row refused, so the document is left exactly as it was.
    expect(storedAttributes(rows, "", stored)).toEqual(stored);
    expect(rowProblems(rows).filter(each => each === undefined)).toHaveLength(
      0
    );
  });
});

describe("which of two rows keeps a key spelled with capitals", () => {
  it("keeps the DOCUMENT's row even when it is not the first one", () => {
    /*
     * The rule is that a row which came from the document and still carries its
     * own name keeps the key, and only first-wins between two document rows.
     * That comparison has to normalize: a bag spelled `DATA-A` supplies a row
     * whose origin is `DATA-A` while the key everything else speaks is
     * `data-a`, so an unnormalized check does not recognise it as the
     * document's row at all — and first-wins then blames it for the new row
     * the author typed above it.
     */
    const rows = [
      { name: "data-a", value: "new" },
      { name: "DATA-A", value: "stored", origin: "DATA-A" },
    ];
    expect(rowProblem(rows, 1)).toBeUndefined();
    expect(rowProblem(rows, 0)).toEqual({ kind: "duplicate" });
    // And the stored value is what survives, not the row typed over it.
    expect(storedAttributes(rows, "", { "DATA-A": "stored" })).toEqual({
      "data-a": "stored",
    });
  });
});

describe("a bag whose id NAME the renderer will not accept", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("reserves nothing for it", () => {
    /*
     * `isAllowedAttribute(" id ")` is false — the renderer checks the STORED
     * name, syntax and all, before lowercasing it — so no id reaches the page
     * and another block may use that value. Reading the name through
     * `attributeKey`, which trims, is the EDITOR's normalization and describes
     * what this panel would write rather than what the document holds.
     */
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { " id ": "hero" } })],
      "a",
      renders
    );
    expect([...taken]).toEqual([]);
  });

  it("still reserves one the renderer WILL accept", () => {
    // The control: the rejection is about the spelling, not about the bag.
    const taken = domIdsTaken(
      [node({ id: "b", attributes: { ID: "hero" } })],
      "a",
      renders
    );
    expect([...taken]).toEqual(["hero"]);
  });
});
