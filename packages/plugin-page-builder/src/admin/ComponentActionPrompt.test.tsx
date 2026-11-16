// @vitest-environment jsdom
/**
 * The detach, duplicate and update-pattern forms against stubbed routes:
 * what each does to the unsaved page, and what each says first.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { ShortcutProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DetachResult,
  DuplicateResult,
} from "../component-actions-contract";

import {
  ComponentActionPrompt,
  type ComponentActionPromptProps,
} from "./ComponentActionPrompt";

const routes = {
  detach: vi.fn(),
  duplicate: vi.fn(),
  update: vi.fn(),
};

vi.mock("./component-actions-client", () => ({
  useDetach: () => ({ send: routes.detach, error: undefined }),
  useDuplicate: () => ({ send: routes.duplicate, error: undefined }),
  useUpdatePattern: () => ({ send: routes.update, error: undefined }),
}));

vi.mock("./pattern-library-client", () => ({
  usePatternLibrary: () => ({
    patterns: [{ id: "pat-1", title: "Hero" }],
  }),
}));

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "p",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "card" },
    },
  ],
};

const DETACH_OPS: BuilderOp[] = [{ kind: "remove", id: "p" }];

function detachAnswer(over: Partial<DetachResult> = {}): DetachResult {
  return {
    dryRun: true,
    pageOps: DETACH_OPS,
    component: { id: "card", title: "Card" },
    unpublishedChanges: false,
    by: { kind: "user", userId: "u1" },
    ...over,
  };
}

function mount(
  action: "detach" | "duplicate" | "update-pattern",
  over: Partial<ComponentActionPromptProps> = {}
) {
  const applyAll = vi.fn<(ops: readonly BuilderOp[]) => BlockDocument | null>(
    () => PAGE
  );
  const onClose = vi.fn();
  const retry = vi.fn();
  const props: ComponentActionPromptProps = {
    request: { action, document: PAGE },
    editor: {
      selection: { ids: ["p"] } as never,
      applyAll,
      select: vi.fn(),
    },
    library: {
      definitions: new Map(),
      components: [{ id: "card", title: "Card", document: null }],
      retry,
    },
    onClose,
    ...over,
  };
  const view = render(
    <ShortcutProvider>
      <ComponentActionPrompt {...props} />
    </ShortcutProvider>
  );
  return { applyAll, onClose, retry, props, view };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("detaching from the editor", () => {
  it("asks for the plan with a dry run, then applies its ops as one step", async () => {
    routes.detach.mockResolvedValue(detachAnswer());
    const { applyAll, onClose } = mount("detach");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Detach" }).hasAttribute("disabled")
      ).toBe(false)
    );
    expect(routes.detach).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, instanceId: "p" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));

    expect(applyAll).toHaveBeenCalledWith(DETACH_OPS);
    expect(onClose).toHaveBeenCalled();
  });

  it("says before detaching when the component has unpublished changes", async () => {
    routes.detach.mockResolvedValue(detachAnswer({ unpublishedChanges: true }));
    mount("detach");

    await waitFor(() =>
      expect(
        screen.getByText(/has changes that are not published/)
      ).toBeTruthy()
    );
  });

  it("applies nothing when the plan was refused", async () => {
    routes.detach.mockResolvedValue(undefined);
    const { applyAll } = mount("detach");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: "Detach" }).hasAttribute("disabled")
    ).toBe(true);
    expect(applyAll).not.toHaveBeenCalled();
  });
});

describe("duplicating from the editor", () => {
  it("names the copy after the source, and re-points the placement once the copy is drawn", async () => {
    const repoint: BuilderOp[] = [
      { kind: "update", id: "p", patch: { props: { componentId: "copy" } } },
    ];
    const answer: DuplicateResult = {
      dryRun: false,
      component: { id: "copy", title: "Card copy" },
      source: { id: "card" },
      definition: { formatVersion: 1, kind: "component", nodes: [] },
      pageOps: repoint,
      by: { kind: "user", userId: "u1" },
    };
    routes.duplicate.mockResolvedValue(answer);
    const { applyAll, retry, props, view } = mount("duplicate");

    expect(
      (screen.getByLabelText("Name of the copy") as HTMLInputElement).value
    ).toBe("Card copy");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    });
    expect(routes.duplicate).toHaveBeenCalledWith({
      title: "Card copy",
      placement: { document: PAGE, instanceId: "p" },
    });
    expect(retry).toHaveBeenCalled();
    expect(applyAll).not.toHaveBeenCalled();

    view.rerender(
      <ShortcutProvider>
        <ComponentActionPrompt
          {...props}
          library={{ ...props.library, definitions: new Map([["copy", PAGE]]) }}
        />
      </ShortcutProvider>
    );
    expect(applyAll).toHaveBeenCalledWith(repoint);
  });
});

describe("a copy the editor cannot load", () => {
  it("leaves the placement unchanged when the copy never reaches the canvas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      routes.duplicate.mockResolvedValue({
        dryRun: false,
        component: { id: "copy", title: "Card copy" },
        source: { id: "card" },
        definition: { formatVersion: 1, kind: "component", nodes: [] },
        pageOps: [{ kind: "update", id: "p", patch: {} }],
        by: { kind: "user", userId: "u1" },
      });
      const { applyAll, onClose } = mount("duplicate");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(applyAll).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the dialogs' words", () => {
  it("speak of this page, never of a placement", async () => {
    // "Placement" is the engine's word; an author placed a component on a
    // page, and the dialogs say what happens on that page.
    routes.detach.mockResolvedValue(detachAnswer());
    mount("detach");
    const detach = await screen.findByRole("dialog");
    expect(detach.textContent).toMatch(/plain blocks/);
    expect(detach.textContent).not.toMatch(/placement/i);
    cleanup();

    mount("duplicate");
    const duplicate = await screen.findByRole("dialog");
    // Only the selected one switches: another of the same on this page keeps
    // the original, so "this page uses it" overstated it.
    expect(duplicate.textContent).toMatch(/the one you selected uses it/);
    expect(duplicate.textContent).toMatch(/other uses on this page included/);
    expect(duplicate.textContent).not.toMatch(/placement/i);
  });

  it("say what a detach is checking in the author's words, while it checks", async () => {
    // Held unanswered, so the line shown while the check is on its way is
    // the one read, rather than whatever is on screen when it lands.
    routes.detach.mockReturnValue(new Promise(() => {}));
    mount("detach");
    const checking = await screen.findByRole("status");
    expect(checking.textContent).toBe("Checking what it draws…");
  });
});

describe("updating a pattern from the editor", () => {
  it("is held until a pattern is chosen, and says earlier inserts keep their copies", () => {
    mount("update-pattern");

    expect(screen.getByText(/keep their own copies/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Update pattern" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(routes.update).not.toHaveBeenCalled();
  });
});
