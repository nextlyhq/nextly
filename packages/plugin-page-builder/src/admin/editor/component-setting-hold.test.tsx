// @vitest-environment jsdom
/**
 * "Make this a setting of the component", the host's half: the new setting
 * is planned by the server without writing, held while the page binds it,
 * drawn over the stored component meanwhile, and written with the page's
 * Save. A refused write takes the page's binding back off, refuses this Save
 * and offers to save again without it.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  applyOps,
  type BlockDocument,
  type BuilderOp,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/ui", async importOriginal => {
  const actual = await importOriginal<typeof import("@nextlyhq/ui")>();
  return {
    ...actual,
    toast: { ...actual.toast, error: toastError, warning: toastWarning },
  };
});

/** The route's answers, as the test sets them, and what was sent. */
const route = vi.hoisted(() => ({
  sent: [] as { path: string; body: Record<string, unknown> }[],
  answer: (_body: Record<string, unknown>): unknown => undefined,
}));
/** The handler the form runs before Save and Publish, and its actions. */
const form = vi.hoisted(() => ({
  before: undefined as
    | undefined
    | ((
        action: string,
        store: { writesSettled(): Promise<boolean> }
      ) => unknown),
  run: vi.fn(),
  locale: null as null | { code: string },
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  writePluginRoute: async ({
    path,
    body,
  }: {
    path: string;
    body: Record<string, unknown>;
  }) => {
    route.sent.push({ path, body });
    return route.answer(body);
  },
  useBeforeDocumentAction: (handler: typeof form.before) => {
    form.before = handler;
  },
  useDocumentActions: () => ({ run: form.run }),
  useDocumentLocale: () => form.locale,
}));

import type { ComponentLibraryRead } from "../component-library-client";

import {
  leavingWithHeldSettings,
  liveSettingHolds,
  useComponentSettingHold,
  useLeavingWithHeldSettings,
} from "./component-setting-hold";

afterEach(() => {
  route.sent.length = 0;
  route.answer = () => undefined;
  form.before = undefined;
  form.run.mockClear();
  form.locale = null;
  toastError.mockClear();
  toastWarning.mockClear();
});

const CARD: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    { id: "k", type: "core/heading", version: 1, props: { text: "New" } },
  ],
  exposed: [],
} as ComponentDocument;

/** The card with its kicker made the "Title" setting, as the plan answers. */
const PLANNED: ComponentDocument = {
  ...CARD,
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "k",
      propPath: "text",
      type: "text",
    },
  ],
} as ComponentDocument;

const ASK = {
  componentId: "card",
  nodeId: "k",
  propPath: "text",
  label: "Title",
};

/** The route's dry-run answer, and its written one. */
function answers(written: "ok" | "refused" | "conflict" | "other-id"): void {
  route.answer = body => {
    if (body.dryRun === true) {
      return {
        message: "planned",
        item: {
          dryRun: true,
          component: { id: "card" },
          definition: PLANNED,
          targetId: "title",
          warnings: [],
          refusals: [],
          fingerprint: "f1",
          by: {},
        },
      };
    }
    if (written === "refused") throw new Error("The component is locked.");
    if (written === "conflict") {
      throw Object.assign(new Error("Changed since you opened it."), {
        status: 409,
      });
    }
    return {
      message: "changed",
      item: {
        dryRun: false,
        component: { id: "card" },
        definition: PLANNED,
        targetId: written === "other-id" ? "title-2" : "title",
        warnings: [],
        refusals: [],
        fingerprint: "f2",
        by: {},
      },
    };
  };
}

function pageWith(bindings?: Record<string, unknown>): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "p",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "card" },
        ...(bindings === undefined ? {} : { bindings }),
      },
    ],
  } as BlockDocument;
}

const BOUND = {
  "overrides.title": { $bind: "title", source: "item", list: "l" },
};

/** The hook over an editor whose document the test moves. */
function mount(document: BlockDocument) {
  const editor = {
    document,
    applyAll: vi.fn((ops: BuilderOp[]) => {
      editor.document = applyOps(editor.document, ops).document;
      return editor.document;
    }),
  };
  const retry = vi.fn();
  const library = {
    definitions: new Map([["card", CARD]]),
    components: [],
    titleOf: (id: string) => (id === "card" ? "Card" : undefined),
    truncated: false,
    state: "ready",
    retry,
  } as unknown as ComponentLibraryRead;
  const hook = renderHook(
    ({ doc }: { doc: BlockDocument }) =>
      useComponentSettingHold({ ...editor, document: doc } as never, library),
    { initialProps: { doc: document } }
  );
  return { hook, editor, retry, library };
}

const settled = { writesSettled: async () => true };

describe("which held settings are live", () => {
  it("is live only while a placement of that component binds the new setting", () => {
    const held = new Map([
      [
        "card",
        {
          componentId: "card",
          settingId: "title",
          definition: PLANNED,
          fingerprint: "f1",
          action: { kind: "expose" as const, ...ASK },
        },
      ],
    ]);
    expect(liveSettingHolds(pageWith(BOUND), held)).toHaveLength(1);
    // Undone: the binding went, and the change to the component with it.
    expect(liveSettingHolds(pageWith(), held)).toEqual([]);
  });
});

describe("making a setting from the page", () => {
  it("plans the setting without writing, and draws the planned component while the page binds it", async () => {
    answers("ok");
    const { hook } = mount(pageWith());
    let answer: unknown;
    await act(async () => {
      answer = await hook.result.current.makeComponentSetting(ASK);
    });
    expect(answer).toEqual({ settingId: "title" });
    expect(route.sent).toEqual([
      {
        path: "/components/card/definition",
        body: {
          action: {
            kind: "expose",
            nodeId: "k",
            propPath: "text",
            label: "Title",
          },
          dryRun: true,
        },
      },
    ]);
    // Not yet bound: the stored component is drawn.
    expect(hook.result.current.library.definitions.get("card")).toBe(CARD);
    hook.rerender({ doc: pageWith(BOUND) });
    expect(hook.result.current.library.definitions.get("card")).toBe(PLANNED);
  });

  it("says why a plan was refused, and holds nothing", async () => {
    route.answer = () => ({
      message: "refused",
      item: {
        dryRun: true,
        component: { id: "card" },
        definition: CARD,
        targetId: "title",
        warnings: [],
        refusals: ["Card is locked by someone else."],
        fingerprint: "f1",
        by: {},
      },
    });
    const { hook } = mount(pageWith());
    let answer: unknown;
    await act(async () => {
      answer = await hook.result.current.makeComponentSetting(ASK);
    });
    expect(answer).toEqual({ refusal: "Card is locked by someone else." });
  });

  it("asks for a save before a second new setting of the same component", async () => {
    answers("ok");
    const { hook } = mount(pageWith());
    await act(async () => {
      await hook.result.current.makeComponentSetting(ASK);
    });
    hook.rerender({ doc: pageWith(BOUND) });
    let answer: unknown;
    await act(async () => {
      answer = await hook.result.current.makeComponentSetting({
        ...ASK,
        label: "Summary",
      });
    });
    expect(answer).toEqual({
      refusal:
        "Save the page first: Card has a new setting waiting to be saved with it.",
    });
  });
});

describe("a page edited in a language", () => {
  it("plans and writes the setting in that language", async () => {
    // A translated component is drawn in the page's language, so it is
    // changed in that language, not the site's default.
    form.locale = { code: "de" };
    answers("ok");
    const mounted = mount(pageWith());
    await act(async () => {
      await mounted.hook.result.current.makeComponentSetting(ASK);
    });
    mounted.editor.document = pageWith(BOUND);
    mounted.hook.rerender({ doc: pageWith(BOUND) });
    await act(async () => {
      await form.before?.("save", settled);
    });
    expect(route.sent.map(sent => sent.body.locale)).toEqual(["de", "de"]);
  });
});

describe("a setting made while the page's Save is writing", () => {
  it("is written by that Save too, before it ends", async () => {
    // Both placements bind their component's new setting.
    const both = (cardBound: boolean, badgeBound: boolean): BlockDocument =>
      ({
        ...pageWith(cardBound ? BOUND : undefined),
        nodes: [
          ...pageWith(cardBound ? BOUND : undefined).nodes,
          {
            id: "q",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "badge" },
            ...(badgeBound ? { bindings: BOUND } : {}),
          },
        ],
      }) as BlockDocument;
    answers("ok");
    const planned = route.answer;
    let release: () => void = () => undefined;
    const slow = new Promise<void>(resolve => {
      release = resolve;
    });
    const mounted = mount(both(false, false));
    await act(async () => {
      await mounted.hook.result.current.makeComponentSetting(ASK);
    });
    mounted.editor.document = both(true, false);
    mounted.hook.rerender({ doc: both(true, false) });
    // The card's write is slow; meanwhile the badge gets a setting.
    route.answer = body =>
      body.dryRun === true ? planned(body) : slow.then(() => planned(body));
    let saving: Promise<unknown> = Promise.resolve();
    await act(async () => {
      saving = Promise.resolve(form.before?.("save", settled));
      await mounted.hook.result.current.makeComponentSetting({
        ...ASK,
        componentId: "badge",
      });
    });
    mounted.editor.document = both(true, true);
    mounted.hook.rerender({ doc: both(true, true) });
    release();
    await act(async () => {
      await saving;
    });
    const written = route.sent
      .filter(sent => sent.body.dryRun !== true)
      .map(sent => sent.path);
    expect(written).toEqual([
      "/components/card/definition",
      "/components/badge/definition",
    ]);
  });
});

describe("a plan still being made", () => {
  it("refuses a second setting of the same component until the first is planned", async () => {
    let release: () => void = () => undefined;
    const answered = new Promise<void>(resolve => {
      release = resolve;
    });
    answers("ok");
    const planned = route.answer;
    route.answer = body => answered.then(() => planned(body));
    const { hook } = mount(pageWith());
    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = hook.result.current.makeComponentSetting(ASK);
      second = await hook.result.current.makeComponentSetting({
        ...ASK,
        nodeId: "other",
        label: "Summary",
      });
    });
    expect(second).toEqual({
      refusal: "Wait a moment: a new setting of Card is still being made.",
    });
    release();
    let answer: unknown;
    await act(async () => {
      answer = await first;
    });
    expect(answer).toEqual({ settingId: "title" });
    // One plan asked for, the first.
    expect(route.sent).toHaveLength(1);
  });
});

describe("leaving the editor for the form", () => {
  async function heldAndBound(written: Parameters<typeof answers>[0]) {
    answers(written);
    const mounted = mount(pageWith());
    await act(async () => {
      await mounted.hook.result.current.makeComponentSetting(ASK);
    });
    mounted.editor.document = pageWith(BOUND);
    mounted.hook.rerender({ doc: pageWith(BOUND) });
    return mounted;
  }

  it("writes each held setting to its component's draft first, and lets the editor close", async () => {
    // The form saves the page; the editor holding the setting is gone by then.
    const { hook, retry } = await heldAndBound("ok");
    let closes: unknown;
    await act(async () => {
      closes = await hook.result.current.writeHeldSettings();
    });
    expect(closes).toBe(true);
    expect(route.sent.at(-1)?.body).toEqual({
      action: { kind: "expose", nodeId: "k", propPath: "text", label: "Title" },
      expect: "f1",
    });
    expect(retry).toHaveBeenCalled();
    // Written: the page's next Save writes it no second time.
    route.sent.length = 0;
    await act(async () => {
      await form.before?.("save", settled);
    });
    expect(route.sent).toEqual([]);
  });

  it("leaves only once the held settings are written", async () => {
    const leave = vi.fn();
    let written: (closes: boolean) => void = () => undefined;
    const write = () =>
      new Promise<boolean>(resolve => {
        written = resolve;
      });
    leavingWithHeldSettings(write, leave)();
    await Promise.resolve();
    expect(leave).not.toHaveBeenCalled();
    written(true);
    await vi.waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    const refusedLeave = vi.fn();
    leavingWithHeldSettings(async () => false, refusedLeave)();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refusedLeave).not.toHaveBeenCalled();
    // Nothing held: the leave is the same call, as before.
    const plainLeave = vi.fn();
    leavingWithHeldSettings(() => true, plainLeave)();
    expect(plainLeave).toHaveBeenCalledTimes(1);
  });

  it("leaves with the editor as it is when the writes end", async () => {
    // The author may edit while the writes are in flight, and the leave
    // commits the document it closes over.
    let written: (closes: boolean) => void = () => undefined;
    const write = () =>
      new Promise<boolean>(resolve => {
        written = resolve;
      });
    const before = vi.fn();
    const after = vi.fn();
    const hook = renderHook(
      ({ leave }: { leave: () => void }) =>
        useLeavingWithHeldSettings(write, leave),
      { initialProps: { leave: before } }
    );
    hook.result.current();
    hook.rerender({ leave: after });
    written(true);
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
    expect(before).not.toHaveBeenCalled();
  });

  it("closes at once when nothing is held", async () => {
    const { hook } = mount(pageWith());
    let closes: unknown;
    await act(async () => {
      closes = await hook.result.current.writeHeldSettings();
    });
    expect(closes).toBe(true);
    expect(route.sent).toEqual([]);
  });

  it("keeps the editor open, with the binding taken off, when the write is refused", async () => {
    const { hook, editor } = await heldAndBound("conflict");
    let closes: unknown;
    await act(async () => {
      closes = await hook.result.current.writeHeldSettings();
    });
    expect(closes).toBe(false);
    expect(editor.document.nodes[0]?.bindings).toBeUndefined();
    const [words] = toastError.mock.calls[0] as [string];
    expect(words).toContain(
      "“Title” wasn't added to Card, so this page's binding to it was taken off."
    );
  });
});

describe("the page's Save", () => {
  async function heldAndBound(written: Parameters<typeof answers>[0]) {
    answers(written);
    const mounted = mount(pageWith());
    await act(async () => {
      await mounted.hook.result.current.makeComponentSetting(ASK);
    });
    mounted.editor.document = pageWith(BOUND);
    mounted.hook.rerender({ doc: pageWith(BOUND) });
    return mounted;
  }

  it("writes the held change with the fingerprint it was planned against, and reads the library again", async () => {
    const { retry, hook } = await heldAndBound("ok");
    await act(async () => {
      await form.before?.("save", settled);
    });
    expect(route.sent.at(-1)).toEqual({
      path: "/components/card/definition",
      body: {
        action: {
          kind: "expose",
          nodeId: "k",
          propPath: "text",
          label: "Title",
        },
        expect: "f1",
      },
    });
    expect(retry).toHaveBeenCalled();
    // Written: nothing is held, so the next Save writes nothing.
    route.sent.length = 0;
    await act(async () => {
      await form.before?.("save", settled);
    });
    expect(route.sent).toEqual([]);
    expect(hook.result.current.library.definitions.get("card")).toBe(CARD);
    // Written here, so not taken for a setting that was never made while the
    // library reads the component again.
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("keeps the hold, and says so, when the binding can't be taken off", async () => {
    // The placement was locked while the write was out.
    const { editor } = await heldAndBound("conflict");
    editor.applyAll.mockImplementation(() => null as never);
    let refused: unknown;
    await act(async () => {
      try {
        await form.before?.("save", settled);
      } catch (error) {
        refused = error;
      }
    });
    expect(refused).toBeInstanceOf(Error);
    const [words] = toastError.mock.calls[0] as [string];
    expect(words).toContain("couldn't be taken off");
    // Still owed: the next Save tries the component again.
    route.sent.length = 0;
    await act(async () => {
      await form.before?.("save", settled).catch(() => undefined);
    });
    expect(route.sent.filter(sent => sent.body.dryRun !== true)).toHaveLength(
      1
    );
  });

  it("takes off a binding to a setting the component doesn't have, nothing held", async () => {
    // A page recovered after a reload holds the binding and not the plan.
    const { editor } = mount(
      pageWith({ "overrides.ghost": { $bind: "title", source: "entry" } })
    );
    await act(async () => {
      await form.before?.("save", settled);
    });
    expect(editor.document.nodes[0]?.bindings).toBeUndefined();
    const [words] = toastWarning.mock.calls[0] as [string];
    expect(words).toContain("Card doesn't have");
    expect(route.sent).toEqual([]);
  });

  it("writes the setting to the component's draft with a page's Publish too", async () => {
    // Publishing it here would publish the component's other unpublished
    // changes unasked: the publish dialog asks for the component instead.
    await heldAndBound("ok");
    await act(async () => {
      await form.before?.("publish", settled);
    });
    expect(route.sent.at(-1)?.body).toEqual({
      action: { kind: "expose", nodeId: "k", propPath: "text", label: "Title" },
      expect: "f1",
    });
  });

  it("writes nothing for a held change the page no longer binds", async () => {
    answers("ok");
    const { hook } = mount(pageWith());
    await act(async () => {
      await hook.result.current.makeComponentSetting(ASK);
    });
    route.sent.length = 0;
    await act(async () => {
      await form.before?.("save", settled);
    });
    expect(route.sent).toEqual([]);
  });

  for (const written of ["refused", "conflict", "other-id"] as const) {
    it(`takes the binding back off, refuses this Save and offers Save again (${written})`, async () => {
      const { editor } = await heldAndBound(written);
      let refused: unknown;
      await act(async () => {
        try {
          await form.before?.("save", settled);
        } catch (error) {
          refused = error;
        }
      });
      expect(refused).toBeInstanceOf(Error);
      // One edit took the binding off the placement.
      expect(editor.applyAll).toHaveBeenCalledTimes(1);
      expect(editor.document.nodes[0]?.bindings).toBeUndefined();
      // Said in plain words, with the way out.
      expect(toastError).toHaveBeenCalledTimes(1);
      const [words, options] = toastError.mock.calls[0] as [
        string,
        { action: { label: string; onClick: () => void } },
      ];
      expect(words).toContain(
        "“Title” wasn't added to Card, so this page's binding to it was taken off."
      );
      expect(options.action.label).toBe("Save again");
      options.action.onClick();
      expect(form.run).toHaveBeenCalledWith("save");
    });
  }
});
