/**
 * Plugins' attention items: what startup refuses, with every other dashboard
 * fault, and what an item's `count` is handed when a reader's digest is read.
 * Who sees which item is the integration test's, against real readers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const holds = vi.hoisted(() => vi.fn());
vi.mock("../../../../auth/entity-read-access", async importOriginal => ({
  ...(await importOriginal<object>()),
  callerHoldsPermission: holds,
}));
const readable = vi.hoisted(() => vi.fn());
vi.mock("../../reader-content", async importOriginal => ({
  ...(await importOriginal<object>()),
  readableCollectionSlugs: readable,
}));

import type { PluginDashboardSnapshot } from "../../../../plugins/dashboard-declarations";
import {
  attentionItemFaults,
  clearAttentionItems,
  MAX_ATTENTION_ITEMS_PER_PLUGIN,
  pluginItemReaders,
  registerAttentionItems,
} from "../items";

const OWNER = 'plugin "forms"';

function snapshot(attention: unknown, owner = OWNER): PluginDashboardSnapshot {
  return {
    owner,
    widgets: [],
    suggest: undefined,
    alternatives: undefined,
    attention,
    unknownKeys: [],
  };
}

const item = (more: Record<string, unknown> = {}) => ({
  id: "forms/unread",
  label: "Unread submissions",
  count: () => Promise.resolve(1),
  link: "forms/submissions",
  permission: "read-form-submissions",
  ...more,
});

const problemsOf = (attention: unknown) =>
  attentionItemFaults([snapshot(attention)]).map(fault => fault.problem);

afterEach(() => {
  clearAttentionItems();
  holds.mockReset();
  readable.mockReset();
});

describe("the startup check", () => {
  it("passes a whole item, with permission or with collections", () => {
    expect(
      attentionItemFaults([
        snapshot([
          item(),
          item({
            id: "forms/spam",
            permission: undefined,
            collections: ["form-submissions"],
          }),
        ]),
      ])
    ).toEqual([]);
  });

  it.each([
    ["an id without a namespace", { id: "unread" }, /namespace\/name/],
    ["a label over two lines", { label: "One\ntwo" }, /one-line label/],
    ["an empty label", { label: " " }, /one-line label/],
    ["no count function", { count: 3 }, /count function/],
    [
      "a link off the admin",
      { link: "https://example.com" },
      /link inside the admin/,
    ],
    [
      "a protocol-relative link",
      { link: "//example.com/x" },
      /link inside the admin/,
    ],
    [
      "a link from the site's root",
      { link: "/forms" },
      /link inside the admin/,
    ],
    [
      "a link stepping out of the admin",
      { link: "../api/x" },
      /link inside the admin/,
    ],
    ["a script link", { link: "javascript:alert(1)" }, /link inside the admin/],
    [
      "both permission and collections",
      { collections: ["form-submissions"] },
      /exactly one of permission or collections/,
    ],
    [
      "neither permission nor collections",
      { permission: undefined },
      /exactly one of permission or collections/,
    ],
    [
      "an empty collections list",
      { permission: undefined, collections: [] },
      /one or more collection slugs/,
    ],
  ])("refuses %s", (_name, override, problem) => {
    expect(problemsOf([item(override)])).toEqual([
      expect.stringMatching(problem),
    ]);
  });

  it.each(["core", "collection", "single"])(
    "refuses the reserved namespace %s",
    namespace => {
      expect(problemsOf([item({ id: `${namespace}/unread` })])).toEqual([
        expect.stringMatching(/reserved namespace/),
      ]);
    }
  );

  it("refuses an id another plugin's item already has, naming the first", () => {
    const faults = attentionItemFaults([
      snapshot([item()], 'plugin "forms"'),
      snapshot([item()], 'plugin "crm"'),
    ]);
    expect(faults).toEqual([
      {
        owner: 'plugin "crm"',
        widget: '(attention "forms/unread")',
        problem: 'repeats the id of an attention item plugin "forms" declares',
      },
    ]);
  });

  it("refuses more items than a plugin may declare", () => {
    const many = Array.from(
      { length: MAX_ATTENTION_ITEMS_PER_PLUGIN + 1 },
      (_, n) => item({ id: `forms/item-${n}` })
    );
    expect(problemsOf(many)).toEqual([
      expect.stringMatching(
        /declares 11 attention items; a plugin may declare at most 10/
      ),
    ]);
    expect(problemsOf(many.slice(1))).toEqual([]);
  });

  it("refuses attention that is not a list, and an entry that is not an item", () => {
    expect(problemsOf({ id: "forms/unread" })).toEqual([
      expect.stringMatching(/must be a list/),
    ]);
    expect(problemsOf(["forms/unread"])).toEqual([
      expect.stringMatching(/is not an attention item/),
    ]);
  });
});

describe("what an item's count is handed", () => {
  it("is the reader, a signal, read services, its plugin's scope and the answer's instant, and no settings", async () => {
    const count = vi.fn().mockResolvedValue(4);
    registerAttentionItems([snapshot([item({ count })])]);
    holds.mockResolvedValue(true);
    const now = new Date("2026-10-27T12:00:00.000Z");
    const caller = { user: { id: "u1" } } as Parameters<
      typeof pluginItemReaders
    >[0];
    const [reader] = await pluginItemReaders(caller, now);
    const signal = new AbortController().signal;
    await expect(reader!.read(signal)).resolves.toBe(4);
    const input = count.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "now",
      "scope",
      "services",
      "signal",
      "user",
    ]);
    expect(input.user).toBe(caller.user);
    expect(input.signal).toBe(signal);
    expect(input.now).toEqual(now);
    expect(typeof (input.scope as { getOrCompute: unknown }).getOrCompute).toBe(
      "function"
    );
  });

  it("ranks as a warning whatever the plugin declared, and keeps its own link", async () => {
    registerAttentionItems([snapshot([item({ severity: "critical" })])]);
    holds.mockResolvedValue(true);
    const [reader] = await pluginItemReaders(
      { user: { id: "u1" } } as Parameters<typeof pluginItemReaders>[0],
      new Date()
    );
    expect(reader).toMatchObject({
      kind: "plugin",
      severity: "warning",
      link: "forms/submissions",
      owner: OWNER,
    });
  });

  it("gives no reader to someone without the item's permission, nor when the check fails", async () => {
    registerAttentionItems([snapshot([item()])]);
    const caller = { user: { id: "u1" } } as Parameters<
      typeof pluginItemReaders
    >[0];
    holds.mockResolvedValue(false);
    await expect(pluginItemReaders(caller, new Date())).resolves.toEqual([]);
    holds.mockRejectedValue(new Error("rbac down"));
    await expect(pluginItemReaders(caller, new Date())).resolves.toEqual([]);
  });
});
