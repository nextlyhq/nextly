/**
 * The header's save state and leading action, drawn for a view with no header:
 * read from the host, the recovery point included, and run through the host's
 * runner rather than by submitting a form the view does not have.
 *
 * @module components/features/entries/EntryForm/__tests__/DocumentSurfaceControls.test
 */
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { RecoveryPointState } from "../SaveStateIndicator";
import type {
  DocumentActionBindings,
  DocumentSaveState,
} from "../useDocumentActionBindings";

let hosted: DocumentActionBindings | null = null;
let recovery: RecoveryPointState = {
  enabled: false,
  storedAt: null,
  pendingOfferAt: null,
};

vi.mock("../DocumentActionsContext", () => ({
  useDocumentActionsContext: () => hosted,
  useHostedRecoveryPoint: () => recovery,
}));

const { DocumentPrimaryAction, DocumentSaveIndicator } = await import(
  "../DocumentSurfaceControls"
);

const run = vi.fn(async () => ({ ok: true as const }));

function host(
  over: Partial<DocumentActionBindings> = {}
): DocumentActionBindings {
  return {
    actions: [],
    primary: undefined,
    bindings: {},
    run,
    saveState: { kind: "saved", at: null },
    lastStoredAt: null,
    ...over,
  } as DocumentActionBindings;
}

afterEach(() => {
  hosted = null;
  recovery = { enabled: false, storedAt: null, pendingOfferAt: null };
  run.mockClear();
});

describe("DocumentSaveIndicator", () => {
  it("draws nothing outside a document editor", () => {
    const { container } = render(<DocumentSaveIndicator />);
    expect(container.textContent).toBe("");
  });

  it("shows the host's save state", () => {
    hosted = host({ saveState: { kind: "unsaved" } });
    render(<DocumentSaveIndicator />);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("reads the host's recovery point: edits held only in one are unsaved", () => {
    hosted = host({ saveState: { kind: "saved", at: new Date() } });
    recovery = {
      enabled: true,
      storedAt: new Date(),
      pendingOfferAt: new Date(),
    };
    render(<DocumentSaveIndicator />);
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("offers Retry on a failed save, and says so assertively", async () => {
    const retry = vi.fn(async () => ({ ok: true as const }));
    const failed: DocumentSaveState = {
      kind: "failed",
      message: "The server did not answer.",
      retry,
    };
    hosted = host({ saveState: failed });
    render(<DocumentSaveIndicator />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("document-status-failure").textContent).toBe(
      "Not saved. The server did not answer."
    );
  });
});

describe("DocumentPrimaryAction", () => {
  it("draws nothing outside a document editor", () => {
    const { container } = render(<DocumentPrimaryAction />);
    expect(container.textContent).toBe("");
  });

  it("runs the leading action through the host's runner", async () => {
    const onSelect = vi.fn();
    hosted = host({
      actions: [{ id: "publish", label: "Publish", placement: "primary" }],
      bindings: { publish: { onSelect } },
    });
    render(<DocumentPrimaryAction />);
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(run).toHaveBeenCalledWith("publish");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("runs a save the header submits as a form, rather than submitting a form the view lacks", async () => {
    hosted = host({
      actions: [{ id: "save", label: "Save", placement: "primary" }],
      bindings: { save: { onSelect: vi.fn(), submitForm: "entry-form" } },
    });
    render(<DocumentPrimaryAction />);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("form")).toBeNull();
    await userEvent.click(button);
    expect(run).toHaveBeenCalledWith("save");
  });

  it("holds an action its binding refuses at this instant, with the reason", async () => {
    hosted = host({
      actions: [{ id: "save", label: "Save", placement: "primary" }],
      bindings: {
        save: { onSelect: vi.fn(), disabledReason: "Nothing to save yet." },
      },
    });
    render(<DocumentPrimaryAction />);
    const button = screen.getByRole("button", { name: "Save" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Nothing to save yet.");
    await userEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });
});
