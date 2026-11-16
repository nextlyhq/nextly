// @vitest-environment jsdom
/**
 * The make-component form against a stubbed route: what a convert does to
 * the unsaved page, and what it leaves when the page cannot take it.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComponentFromSelectionResult } from "../library-contract";

import type { ComponentFromSelectionWriter } from "./component-from-selection-client";
import {
  ComponentFromSelectionPrompt,
  type ComponentFromSelectionPromptProps,
} from "./ComponentFromSelectionPrompt";

const writer: {
  current: ComponentFromSelectionWriter;
} = { current: undefined as never };

vi.mock("./component-from-selection-client", () => ({
  useComponentFromSelection: () => writer.current,
}));

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [{ id: "h", type: "core/heading", version: 1, props: {} }],
};

const CONVERT_OPS: BuilderOp[] = [
  { kind: "remove", id: "h" },
  {
    kind: "insert",
    node: {
      id: "placed",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "cmp-1" },
    },
    at: { index: 0 },
  },
];

function result(
  over: Partial<ComponentFromSelectionResult> = {}
): ComponentFromSelectionResult {
  return {
    dryRun: false,
    action: "convert",
    apply: "library",
    component: { id: "cmp-1", title: "Hero" },
    definition: { formatVersion: 1, kind: "component", nodes: [] },
    pageOps: CONVERT_OPS,
    warnings: [],
    by: { kind: "user", userId: "u1" },
    ...over,
  };
}

function stubWriter(over: Partial<ComponentFromSelectionWriter> = {}) {
  writer.current = {
    preview: vi.fn(() => Promise.resolve(result({ dryRun: true }))),
    create: vi.fn(() => Promise.resolve(result())),
    previewError: undefined,
    createError: undefined,
    creating: false,
    ...over,
  };
}

function mount(over: Partial<ComponentFromSelectionPromptProps> = {}) {
  const applyAll = vi.fn<(ops: readonly BuilderOp[]) => BlockDocument | null>(
    () => PAGE
  );
  const select = vi.fn();
  const retry = vi.fn();
  const onClose = vi.fn();
  const props: ComponentFromSelectionPromptProps = {
    request: { action: "convert", document: PAGE },
    editor: {
      selection: { ids: ["h"] } as never,
      lockDefinitions: { get: () => undefined },
      applyAll,
      select,
    },
    library: { definitions: new Map(), components: [], retry },
    onClose,
    ...over,
  };
  const view = render(
    <ShortcutProvider>
      <ComponentFromSelectionPrompt {...props} />
    </ShortcutProvider>
  );
  return { applyAll, select, retry, onClose, props, view };
}

async function confirm(): Promise<void> {
  await waitFor(() =>
    expect(screen.queryByText("Checking what this will change…")).toBeNull()
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Hero" },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Turn into component" })
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("converting from the editor", () => {
  it("applies the page ops once the canvas holds the new definition, as one step", async () => {
    stubWriter();
    const { applyAll, select, retry, onClose, props, view } = mount();

    await confirm();
    // Created, and the library asked to re-read; nothing applied yet.
    expect(retry).toHaveBeenCalledTimes(1);
    expect(applyAll).not.toHaveBeenCalled();

    view.rerender(
      <ShortcutProvider>
        <ComponentFromSelectionPrompt
          {...props}
          library={{
            ...props.library,
            definitions: new Map([["cmp-1", PAGE]]),
          }}
        />
      </ShortcutProvider>
    );

    expect(applyAll).toHaveBeenCalledTimes(1);
    expect(applyAll).toHaveBeenCalledWith(CONVERT_OPS);
    expect(select).toHaveBeenCalledWith("placed", "replace");
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves the page unchanged when it refuses the ops, and the component unused", async () => {
    stubWriter();
    const { applyAll, select, onClose, props, view } = mount();
    applyAll.mockReturnValue(null);

    await confirm();
    view.rerender(
      <ShortcutProvider>
        <ComponentFromSelectionPrompt
          {...props}
          library={{
            ...props.library,
            definitions: new Map([["cmp-1", PAGE]]),
          }}
        />
      </ShortcutProvider>
    );

    // The one apply was refused, so nothing of the page changed, and nothing
    // was selected as if it had.
    expect(applyAll).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("applies nothing when the new definition never reaches the canvas", async () => {
    stubWriter();
    const { applyAll, onClose } = mount();

    await confirm();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(applyAll).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("applies nothing when the create is refused, and says why", async () => {
    stubWriter({
      create: vi.fn(() => Promise.resolve(undefined)),
      createError: "You do not have permission to publish components.",
    });
    const { applyAll, onClose } = mount();

    await confirm();

    expect(applyAll).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "permission to publish components"
    );
  });

  it("refuses to convert when the dry run refused, before anything is created", async () => {
    stubWriter({
      preview: vi.fn(() => Promise.resolve(undefined)),
      previewError: "As a component, this selection would nest too deep.",
    });
    mount();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("nest too deep")
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hero" },
    });
    expect(
      screen
        .getByRole("button", { name: "Turn into component" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("saving from the editor", () => {
  it("creates the component and leaves the page alone", async () => {
    stubWriter({
      create: vi.fn(() =>
        Promise.resolve(result({ action: "save-as", pageOps: [] }))
      ),
    });
    const { applyAll, onClose } = mount({
      request: { action: "save-as", document: PAGE },
    });

    await waitFor(() =>
      expect(screen.queryByText("Checking what this will change…")).toBeNull()
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hero" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save component" }));
    });

    expect(applyAll).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("one form for both ways", () => {
  const keep = () =>
    screen.getByRole("checkbox", {
      name: "Keep the original blocks on this page",
    });

  it("is titled for the one menu item, replacing the blocks unless asked to keep them", async () => {
    stubWriter();
    mount();
    expect(
      screen.getByRole("heading", { name: "Turn into component" })
    ).toBeTruthy();
    expect(keep().getAttribute("aria-checked")).toBe("false");
    await waitFor(() =>
      expect(screen.queryByText("Checking what this will change…")).toBeNull()
    );
  });

  it("keeps the originals and saves a copy when the author ticks it", async () => {
    stubWriter({
      create: vi.fn(() =>
        Promise.resolve(result({ action: "save-as", pageOps: [] }))
      ),
    });
    const { applyAll, onClose } = mount();
    await waitFor(() =>
      expect(screen.queryByText("Checking what this will change…")).toBeNull()
    );
    fireEvent.click(keep());
    // The dry run is asked again, for what the form will now do.
    await waitFor(() =>
      expect(writer.current.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: "save-as" })
      )
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hero" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save component" }));
    });
    expect(writer.current.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "save-as" })
    );
    expect(applyAll).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("holds the choice where only one way is open, and says why", async () => {
    stubWriter();
    mount({
      request: {
        action: "save-as",
        document: PAGE,
        choice: {
          replaceRefused: "A locked block can’t be taken off the page.",
        },
      },
    });
    expect(keep().getAttribute("aria-checked")).toBe("true");
    expect(keep().hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("A locked block can’t be taken off the page.")
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("Checking what this will change…")).toBeNull()
    );
  });
});
