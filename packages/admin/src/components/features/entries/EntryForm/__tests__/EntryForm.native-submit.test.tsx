/**
 * The entry form's native submit — Enter in a field, or the submit-typed Save
 * of a collection without a status — runs the document's Save action.
 *
 * What these pin is the two things that used to differ: what it stores, which
 * is now exactly what Mod+S stores (the save the document's state calls for,
 * never Publish), and what it waits for, which is now everything Save waits
 * for. A native submit that called the form's handler directly passes neither.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

const { useDocumentLock, update } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// The save is observed where it leaves the editor: the update mutation.
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: null,
    isResolved: true,
    dismiss: () => {},
    restore: () => {},
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
// Every permission held: which save runs is the question, not who may.
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import {
  DocumentActionsHost,
  SaveActionFormProvider,
} from "../DocumentActionsContext";
import { EntryForm } from "../EntryForm";
import { useTrackedWrite } from "../useDocumentActionHooks";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
  update.mockResolvedValue({ item: { id: "e1", title: "Saved" } });
});

afterEach(() => {
  cleanup();
});

describe("the entry form's native submit", () => {
  it("saves a draft, never publishes, on a draft whose leading action is Publish", async () => {
    const collection = {
      name: "pages",
      label: "Pages",
      status: true,
      fields: [{ name: "title", type: "text", label: "Title" }],
    } as never;
    const entry = { id: "e1", title: "Hello", status: "draft" } as never;
    const user = userEvent.setup();
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    // Publish leads here, which is what makes "never Publish" a real claim.
    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /title/i }), "!");

    // The submit Enter performs in a field. Whether a given field submits on
    // Enter is the browser's call and unchanged; what the submit stores is
    // what is on trial.
    const form = document.querySelector("form#entry-form");
    if (form === null) throw new Error("no entry form");
    fireEvent.submit(form);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hello!", status: "draft" })
    );
  });
});

describe("a native submit on a collection without a status", () => {
  it("waits for a write the document depends on, as Save does", async () => {
    const onSubmit = vi.fn(() =>
      Promise.resolve({ ok: true as const, item: { id: "e1" } })
    );
    let land: () => void = () => {};
    const write = new Promise<void>(resolve => {
      land = resolve;
    });
    const tracked: { track: (label: string, w: Promise<unknown>) => void } = {
      track: () => {},
    };
    function Tracker(): null {
      tracked.track = useTrackedWrite();
      return null;
    }
    function Harness(): ReactElement {
      const form = useForm<Record<string, unknown>>({
        defaultValues: { title: "Hello" },
      });
      return (
        <DocumentActionsHost
          input={{
            mode: "edit",
            hasStatus: false,
            entry: { id: "e1", title: "Hello" },
            collectionSlug: "notes",
            onSubmit,
          }}
        >
          <SaveActionFormProvider form={form}>
            <Tracker />
          </SaveActionFormProvider>
        </DocumentActionsHost>
      );
    }
    render(<Harness />, { wrapper: Providers });
    act(() => {
      tracked.track("Site colours", write);
    });

    const form = document.querySelector("form#entry-form");
    if (form === null) throw new Error("no entry form");
    fireEvent.submit(form);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      land();
      await write;
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
