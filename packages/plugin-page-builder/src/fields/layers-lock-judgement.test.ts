/**
 * Which stored value a write's Layers locks are judged against, and what a
 * write that cannot be judged gets.
 *
 * The SQLite suite (`__tests__/layers-lock.integration.test.ts`) shows the
 * refusals through the Direct API. What it cannot set up is a language whose
 * store is not ready yet, which is the one read that keeps a write unjudged
 * rather than failing it; that, and the exact read asked for, are pinned here
 * against a stored read the test controls, as is what an open breakpoint
 * removal lets a locked block lose: its removed breakpoints' values, and
 * nothing else.
 */
import {
  NextlyError,
  type PluginFieldValidateArgs,
  type PluginFieldWrite,
  type PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";

import type { OpenRemovalReader } from "../breakpoint-removal/lock-acceptance";
import type { Removal } from "../breakpoint-removal/strip";

import { layersLockIssues, withLockIssues } from "./layers-lock-judgement";
import { LAYERS_LOCK_CHANGED } from "./layers-lock-wording";

const lockedPage = (tone: string) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "hero",
      type: "core/box",
      version: 1,
      props: { tone },
      locked: true,
      name: "Hero",
    },
  ],
});

function writeTo(
  readStored: PluginFieldWrite["readStored"],
  extra: Partial<PluginFieldWrite> = {}
): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    readStored,
    ...extra,
  };
}

function argsFor(
  write: PluginFieldWrite | undefined,
  extra: Partial<PluginFieldValidateArgs> = {},
  localized = false
): PluginFieldValidateArgs {
  return {
    data: {},
    req: {},
    field: { name: "content", type: "blocks", localized },
    path: "content",
    mode: "update",
    ...(write === undefined ? {} : { write }),
    ...extra,
  } as PluginFieldValidateArgs;
}

describe("layersLockIssues", () => {
  it("reads the newest stored form alone, in the write's language", async () => {
    const asked: PluginStoredValueTarget[] = [];
    const issues = await layersLockIssues(
      lockedPage("light"),
      argsFor(
        writeTo(
          async target => {
            asked.push(target);
            return { kind: "value", value: lockedPage("dark") };
          },
          { locale: "de" }
        )
      ),
      "Content"
    );

    expect(asked).toEqual([
      {
        collection: "pages",
        id: "p1",
        field: "content",
        form: "draft",
        locale: "de",
      },
    ]);
    expect(issues).toEqual([
      {
        path: "content",
        code: LAYERS_LOCK_CHANGED,
        message: expect.stringContaining('"Hero" is locked in Layers'),
      },
    ]);
    expect(issues[0]?.message).toMatch(/^Content\/nodes\/0: /);
  });

  it("refuses emptying a translated field in the language the write is in", async () => {
    // Core hands the validator an emptied value (`validateEmpty`), with the
    // write's language, so a `null` is judged like any other replacement.
    const asked: PluginStoredValueTarget[] = [];
    const issues = await layersLockIssues(
      null,
      argsFor(
        writeTo(
          async target => {
            asked.push(target);
            return { kind: "value", value: lockedPage("dark") };
          },
          { locale: "de" }
        ),
        {},
        true
      ),
      "Content"
    );

    expect(asked.map(target => target.locale)).toEqual(["de"]);
    expect(issues).toEqual([
      expect.objectContaining({
        code: LAYERS_LOCK_CHANGED,
        message: expect.stringContaining("would remove it"),
      }),
    ]);
  });

  it("keeps a translated field's write whose language store is not ready, and says so", async () => {
    const onUnjudged = vi.fn();
    const issues = await layersLockIssues(
      lockedPage("light"),
      argsFor(
        writeTo(async () => {
          throw NextlyError.serviceUnavailable();
        }),
        {},
        true
      ),
      "Content",
      onUnjudged
    );

    expect(issues).toEqual([]);
    expect(onUnjudged).toHaveBeenCalledWith({
      field: "content",
      kind: "collection",
      slug: "pages",
      id: "p1",
      reason: "language-not-ready",
    });
  });

  it("fails the write on any other failure to read, rather than passing it unjudged", async () => {
    // The same answer on a field NOT kept per language is an error: only a
    // translated field has a store that can be not ready yet.
    const notReady = writeTo(async () => {
      throw NextlyError.serviceUnavailable();
    });
    await expect(
      layersLockIssues(lockedPage("light"), argsFor(notReady), "Content")
    ).rejects.toThrow();
  });

  it("warns, and reads nothing, for a blocks field inside a group or a repeater", async () => {
    // Its stored value cannot be read, so its locks cannot be judged: the
    // write is kept and the server log is told, rather than it passing in
    // silence.
    const readStored = vi.fn(async () => ({
      kind: "value" as const,
      value: lockedPage("dark"),
    }));
    const onUnjudged = vi.fn();
    for (const path of ["sections[0].content", "hero.content"]) {
      expect(
        await layersLockIssues(
          lockedPage("light"),
          argsFor(writeTo(readStored), { path }),
          "Content",
          onUnjudged
        )
      ).toEqual([]);
    }
    expect(readStored).not.toHaveBeenCalled();
    expect(onUnjudged.mock.calls.map(([found]) => found)).toEqual([
      expect.objectContaining({
        field: "sections[0].content",
        reason: "nested-field",
      }),
      expect.objectContaining({
        field: "hero.content",
        reason: "nested-field",
      }),
    ]);
  });

  it("reads nothing for a create, a value judged alone, or a nested field", async () => {
    const readStored = vi.fn(async () => ({
      kind: "value" as const,
      value: lockedPage("dark"),
    }));
    const value = lockedPage("light");
    expect(
      await layersLockIssues(
        value,
        argsFor(writeTo(readStored), { mode: "create" }),
        "Content"
      )
    ).toEqual([]);
    expect(
      await layersLockIssues(value, argsFor(undefined), "Content")
    ).toEqual([]);
    expect(
      await layersLockIssues(
        value,
        argsFor(writeTo(readStored), { path: "sections[0].content" }),
        "Content"
      )
    ).toEqual([]);
    expect(readStored).not.toHaveBeenCalled();
    // The control: the same value on a top-level update is read and refused.
    expect(
      await layersLockIssues(value, argsFor(writeTo(readStored)), "Content")
    ).toHaveLength(1);
  });
});

describe("withLockIssues", () => {
  it("keeps the rules' answer when no lock broke, and adds to it otherwise", () => {
    const lock = { path: "content", code: LAYERS_LOCK_CHANGED, message: "x" };
    expect(withLockIssues(true, [], "content")).toBe(true);
    expect(withLockIssues(true, [lock], "content")).toEqual([lock]);
    expect(withLockIssues("bad", [lock], "content")).toEqual([
      { path: "content", message: "bad" },
      lock,
    ]);
    const rule = { path: "content", code: "wrong-parent", message: "y" };
    expect(withLockIssues([rule], [lock], "content")).toEqual([rule, lock]);
  });
});

describe("layersLockIssues while a breakpoint removal is open", () => {
  /** A locked block styled at Mobile and at Tablet. */
  const lockedStyled = (tone: string, mobile: boolean) => ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "hero",
        type: "core/box",
        version: 1,
        props: { tone },
        locked: true,
        name: "Hero",
        styles: {
          base: {
            tablet: { color: "#444444" },
            ...(mobile ? { mobile: { color: "#222222" } } : {}),
          },
        },
      },
    ],
  });
  const removingMobile: Removal = {
    ids: new Set(["mobile"]),
    before: {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 900 },
        { id: "mobile", label: "Mobile", maxWidth: 600 },
      ],
      container: [],
    },
  };
  const stored = writeTo(async () => ({
    kind: "value",
    value: lockedStyled("dark", true),
  }));
  const judged = (
    value: unknown,
    open: OpenRemovalReader | undefined,
    write: PluginFieldWrite = stored
  ) => layersLockIssues(value, argsFor(write), "Content", undefined, open);

  it("accepts the locked block stripped of exactly the removed breakpoint", async () => {
    expect(
      await judged(lockedStyled("dark", false), async () => ({
        kind: "strip",
        removal: removingMobile,
      }))
    ).toEqual([]);
  });

  it("refuses the strip with anything else changed on the locked block", async () => {
    expect(
      await judged(lockedStyled("light", false), async () => ({
        kind: "strip",
        removal: removingMobile,
      }))
    ).toHaveLength(1);
  });

  it("refuses the strip with no removal open, or none to read", async () => {
    expect(
      await judged(lockedStyled("dark", false), async () => null)
    ).toHaveLength(1);
    expect(await judged(lockedStyled("dark", false), undefined)).toHaveLength(
      1
    );
  });

  it("refuses the strip when the open removal cannot be read", async () => {
    const unreadable: OpenRemovalReader = async () => {
      throw new Error("the table cannot be read");
    };
    expect(await judged(lockedStyled("dark", false), unreadable)).toHaveLength(
      1
    );
  });

  it("refuses the strip from a write inside a transaction", async () => {
    const inTransaction = writeTo(
      async () => ({ kind: "value", value: lockedStyled("dark", true) }),
      { inTransaction: true }
    );
    expect(
      await judged(
        lockedStyled("dark", false),
        async () => ({ kind: "strip", removal: removingMobile }),
        inTransaction
      )
    ).toHaveLength(1);
  });
  /** What removing Mobile kept of the hero. */
  const keptOfHero = {
    nodes: { hero: { styles: { base: { mobile: { color: "#222222" } } } } },
  };
  /**
   * An undo of that removal, open: for the page's `field`, it puts the hero's
   * Mobile value back into `current`, the value its walk writes.
   */
  const undoing =
    (field: string, current: unknown = lockedStyled("dark", false)) =>
    (): ReturnType<OpenRemovalReader> =>
      Promise.resolve({
        kind: "restore",
        restoreFor: target =>
          Promise.resolve(
            target.slug === "pages" &&
              target.id === "p1" &&
              target.field === field
              ? { current, fragments: [keptOfHero] }
              : undefined
          ),
      });
  const strippedStored = writeTo(async () => ({
    kind: "value",
    value: lockedStyled("dark", false),
  }));

  it("accepts the locked block with exactly what the undone removal kept put back", async () => {
    expect(
      await judged(
        lockedStyled("dark", true),
        undoing("content"),
        strippedStored
      )
    ).toEqual([]);
  });

  it("refuses the restore with anything else changed on the locked block", async () => {
    expect(
      await judged(
        lockedStyled("light", true),
        undoing("content"),
        strippedStored
      )
    ).toHaveLength(1);
  });

  it("refuses a restore of what was kept for another field", async () => {
    expect(
      await judged(lockedStyled("dark", true), undoing("aside"), strippedStored)
    ).toHaveLength(1);
  });

  it("refuses a restore into a stored form the undo's walk does not write", async () => {
    // The walk writes another form (a draft that differs from this one), so
    // putting its fragments back into this form is no write it makes.
    expect(
      await judged(
        lockedStyled("dark", true),
        undoing("content", lockedStyled("other", false)),
        strippedStored
      )
    ).toHaveLength(1);
  });
});
