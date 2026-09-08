/**
 * The palette's command list.
 *
 * The property worth defending is that availability is DERIVED from
 * `toolbarActions` rather than re-decided here. A palette that answered "can
 * this move" for itself would eventually offer a command the toolbar shows as
 * unavailable, and the author would meet the disagreement as a row that runs
 * and does nothing.
 *
 * @module builder-commands.test
 */
import { describe, expect, it, vi } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import {
  blockActionRunners,
  builderCommands,
  type CommandVerbs,
} from "./builder-commands";
import { toolbarActions } from "./toolbar-actions";

function node(id: string, extra: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
    type: "acme/heading",
    version: 1,
    props: {},
    ...extra,
  } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function verbs(): CommandVerbs & Record<string, ReturnType<typeof vi.fn>> {
  return {
    move: vi.fn(),
    delete: vi.fn(),
    duplicate: vi.fn(),
    selectParent: vi.fn(),
    saveAsPattern: vi.fn(),
  } as unknown as CommandVerbs & Record<string, ReturnType<typeof vi.fn>>;
}

function build(over: Partial<Parameters<typeof builderCommands>[0]> = {}) {
  return builderCommands({
    document: documentOf([node("a"), node("b")]),
    selectedId: "a",
    verbs: verbs(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    ...over,
  });
}

describe("builderCommands", () => {
  it("offers no block commands without a selection", () => {
    expect(build({ selectedId: null }).map(c => c.id)).toEqual([]);
  });

  it("omits a block verb the toolbar would show as unavailable", () => {
    // `a` is first, so it cannot move up. Derived rather than re-decided: this
    // is the same answer the toolbar gives, from the same call.
    const ids = build({ selectedId: "a" }).map(c => c.id);

    expect(ids).toContain("block.move-down");
    expect(ids).not.toContain("block.move-up");
  });

  it("omits what a LOCK forbids while keeping what it does not", () => {
    // The case that separates deriving from re-deciding. A lock stops moving
    // and deleting but NOT duplicating, and only a rule that asked
    // `toolbarActions` gets all three right at once.
    const ids = build({
      document: documentOf([node("a", { locked: true }), node("b")]),
      selectedId: "a",
    }).map(c => c.id);

    expect(ids).toContain("block.duplicate");
    expect(ids).not.toContain("block.move-down");
    expect(ids).not.toContain("block.delete");
  });

  it("runs the verb the command names", () => {
    const spies = verbs();
    const commands = build({ selectedId: "a", verbs: spies });

    commands.find(c => c.id === "block.duplicate")?.run();
    expect(spies.duplicate).toHaveBeenCalled();

    commands.find(c => c.id === "block.move-down")?.run();
    expect(spies.move).toHaveBeenCalledWith("down");
  });

  it("offers undo and redo only when there is something to undo or redo", () => {
    expect(
      build({ canUndo: false, canRedo: false }).map(c => c.id)
    ).not.toContain("history.undo");
    expect(build({ canUndo: true }).map(c => c.id)).toContain("history.undo");
    expect(build({ canRedo: true }).map(c => c.id)).toContain("history.redo");
  });

  it("offers a way out only when the host has somewhere to go", () => {
    // Embedded in a form that is already on screen there is nowhere to close
    // to, and a command that does nothing is worse than an absent one.
    expect(build().map(c => c.id)).not.toContain("editor.exit");
    expect(build({ onExit: vi.fn() }).map(c => c.id)).toContain("editor.exit");
  });

  it("gives every command a unique id, which the palette keys selection on", () => {
    // Two rows sharing an id are both marked selected and Enter runs the first
    // whichever the author chose — a defect the palette's own contract calls
    // out and cannot defend against itself.
    const ids = build({
      selectedId: "b",
      canUndo: true,
      canRedo: true,
      onExit: vi.fn(),
    }).map(c => c.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(4);
  });

  it("names its subject, because a palette row has no block beside it", () => {
    // "Duplicate" is unambiguous on a toolbar button drawn at the block. In a
    // searched list it is not, so the label carries the noun and the keyword
    // carries the short word people actually type.
    const duplicate = build().find(c => c.id === "block.duplicate");

    expect(duplicate?.label).toBe("Duplicate block");
    expect(duplicate?.keywords).toContain("duplicate");
  });
});

describe("every verb the bar offers can actually be run", () => {
  it("binds a runner for each id `toolbarActions` emits", () => {
    // The invariant the totalised map exists for, asserted against what the bar
    // ACTUALLY emits rather than against the union it is typed by. The union is
    // checked by the compiler; what it cannot check is that the two stay the
    // same set — a verb emitted with no runner reaches an author as a control
    // that accepts a click and does nothing.
    const runners = blockActionRunners(verbs());
    const document = documentOf([node("a"), node("b"), node("c")]);
    const emitted = [
      ...toolbarActions(document, "a"),
      ...toolbarActions(document, "a", ["a", "b"]),
      ...toolbarActions(document, "a", ["a", "c"]),
    ].map(action => action.id);

    // The control: an empty emission would make the loop below assert nothing.
    expect(new Set(emitted).size).toBeGreaterThan(1);
    for (const id of new Set(emitted)) {
      expect(typeof runners[id]).toBe("function");
    }
  });

  it("runs a DIFFERENT verb for every id", () => {
    // Derived from the map rather than from a list of names, so the next verb
    // is covered by this the day it is added.
    //
    // The signature is what the runner actually did — which verb, with which
    // argument — rather than how many verbs fired. Counting was the first
    // version and it proved nothing: binding `save-as-pattern` to `verbs.delete`
    // still fires exactly one call per id, so two ids doing the same thing
    // passed. `move-up` and `move-down` share a verb and differ by argument,
    // which is why the argument is part of the signature rather than the verb
    // alone.
    const spies = verbs();
    const runners = blockActionRunners(spies);

    const signatures = new Map<string, string>();
    for (const [id, run] of Object.entries(runners)) {
      const before = new Map(
        Object.entries(spies).map(([name, spy]) => [
          name,
          spy.mock.calls.length,
        ])
      );
      run();
      const fired = Object.entries(spies)
        .filter(
          ([name, spy]) => spy.mock.calls.length > (before.get(name) ?? 0)
        )
        .map(([name, spy]) => `${name}(${JSON.stringify(spy.mock.lastCall)})`);
      expect({ id, fired: fired.length }).toEqual({ id, fired: 1 });
      signatures.set(id, fired[0] as string);
    }

    // Every id did something no other id did.
    expect(new Set(signatures.values()).size).toBe(signatures.size);
  });
});
