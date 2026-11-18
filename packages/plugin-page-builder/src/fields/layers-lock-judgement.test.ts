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

import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type MigrationSource,
} from "@nextlyhq/blocks-engine";

import type { OpenRemovalReader } from "../breakpoint-removal/lock-acceptance";
import type { Removal } from "../breakpoint-removal/strip";

import { withRewriteScope } from "../host-rewrite/rewrite-scope";

import {
  layersLockIssues,
  UPGRADE_DEPTH_BOUND,
  withLockIssues,
} from "./layers-lock-judgement";
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
  it("judges each copy of a field rewrite against that copy's own stored value", async () => {
    // The live copy holds a dark hero; the draft beside it a light one.
    const readStored = vi.fn(async () => ({
      kind: "value" as const,
      value: lockedPage("light"),
    }));
    const judged = (current: unknown) =>
      withRewriteScope(
        {
          siteDefinitions: undefined,
          current: { field: "content", stored: current },
        },
        () =>
          layersLockIssues(
            lockedPage("dark"),
            argsFor(writeTo(readStored)),
            "Content"
          )
      );

    // The live copy keeps its own locked hero: nothing broken, and the draft
    // is not read.
    expect(await judged(lockedPage("dark"))).toEqual([]);
    expect(readStored).not.toHaveBeenCalled();
    // A copy whose own hero differs is still judged, against itself.
    expect(await judged(lockedPage("light"))).toEqual([
      expect.objectContaining({ code: LAYERS_LOCK_CHANGED }),
    ]);
    // CONTROL: outside a rewrite, the same value is judged against the
    // newest stored form, the draft, and refused.
    expect(
      await layersLockIssues(
        lockedPage("dark"),
        argsFor(writeTo(readStored)),
        "Content"
      )
    ).toEqual([expect.objectContaining({ code: LAYERS_LOCK_CHANGED })]);
  });

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

describe("layersLockIssues, on a locked block stored at an older version", () => {
  /** A Quote whose version 2 moved its source address to `href`. */
  const quoteSource: MigrationSource = {
    get: type =>
      type === "core/quote"
        ? {
            version: 2,
            migrate: { 1: props => props },
            renames: { 1: { citeUrl: "href" } },
          }
        : undefined,
  };
  const page = (node: Record<string, unknown>) => ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "q", type: "core/quote", locked: true, ...node }],
  });
  const stored = page({ version: 1, props: { citeUrl: "/talk" } });
  const judge = (
    value: unknown,
    migration?: MigrationSource,
    held: unknown = stored
  ) =>
    layersLockIssues(
      value,
      argsFor(writeTo(async () => ({ kind: "value" as const, value: held }))),
      "Content",
      undefined,
      undefined,
      migration
    );

  /** A chain of `levels` unlocked boxes, the deepest holding nothing. */
  const boxes = (levels: number, prefix = "n"): Record<string, unknown> => {
    let node: Record<string, unknown> = {
      id: `${prefix}-leaf`,
      type: "acme/box",
      version: 1,
      props: {},
    };
    for (let level = 0; level < levels; level++) {
      node = {
        id: `${prefix}${String(level)}`,
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: [node] },
      };
    }
    return node;
  };

  it("keeps a write holding it upgraded, as the editor opened it", async () => {
    // The editor upgrades every block it opens, so a save of an unrelated
    // edit carries the locked Quote at version 2 with its address moved.
    const upgraded = page({ version: 2, props: { href: "/talk" } });
    expect(await judge(upgraded, quoteSource)).toEqual([]);
    // CONTROL: judged against the stored form as it was, the same write
    // reads as the locked block changed.
    expect(await judge(upgraded)).toEqual([
      expect.objectContaining({ code: LAYERS_LOCK_CHANGED }),
    ]);
  });

  it("keeps a write holding it as stored, from a client that did not upgrade it", async () => {
    expect(await judge(stored, quoteSource)).toEqual([]);
  });

  it("does not walk a write nested past what the upgrade may walk", async () => {
    // Upgrading walks the tree by recursion. The field's own rules refuse a
    // value nested this deep, and this judgement still runs on it, so it
    // compares such a value as it came rather than walking it.
    const nested = (levels: number) => ({
      ...page({ version: 1, props: {} }),
      nodes: [boxes(levels)],
    });
    const asked: string[] = [];
    const watching: MigrationSource = {
      get: type => (asked.push(type), quoteSource.get(type)),
    };
    await judge(nested(UPGRADE_DEPTH_BOUND + 5), watching);
    expect(asked).not.toContain("acme/box");
    // CONTROL: a shallow write is upgraded, its blocks asked.
    await judge(nested(2), watching);
    expect(asked).toContain("acme/box");
  });

  it("keeps a write that trims a page stored deeper than the site's cap", async () => {
    // A site that lowers its cap leaves pages deeper than it. An author who
    // removes the deep branch, leaving the locked Quote alone, is repairing
    // the page; the locked Quote must not read as changed.
    const deepStored = {
      ...page({ version: 1, props: { citeUrl: "/talk" } }),
      nodes: [
        ...page({ version: 1, props: { citeUrl: "/talk" } }).nodes,
        boxes(DEFAULT_LIMITS.maxDepth + 8),
      ],
    };
    const trimmed = page({ version: 2, props: { href: "/talk" } });
    expect(await judge(trimmed, quoteSource, deepStored)).toEqual([]);
  });

  it("still refuses a change to the locked block", async () => {
    const changed = page({ version: 2, props: { href: "/elsewhere" } });
    expect(await judge(changed, quoteSource)).toEqual([
      expect.objectContaining({ code: LAYERS_LOCK_CHANGED }),
    ]);
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
