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
vi.mock("@nextlyhq/ui", async importOriginal => {
  const actual = await importOriginal<typeof import("@nextlyhq/ui")>();
  return { ...actual, toast: { ...actual.toast, error: toastError } };
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
}));

import type { ComponentLibraryRead } from "../component-library-client";

import {
  liveSettingHolds,
  useComponentSettingHold,
} from "./component-setting-hold";

afterEach(() => {
  route.sent.length = 0;
  route.answer = () => undefined;
  form.before = undefined;
  form.run.mockClear();
  toastError.mockClear();
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
  });

  it("publishes the component with a page's Publish", async () => {
    await heldAndBound("ok");
    await act(async () => {
      await form.before?.("publish", settled);
    });
    expect(route.sent.at(-1)?.body).toMatchObject({ publish: true });
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
