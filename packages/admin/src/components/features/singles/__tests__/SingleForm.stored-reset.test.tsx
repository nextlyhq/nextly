/**
 * What a Single's form holds after a save: what the server stored, without
 * losing what the author typed since.
 *
 * Driven through a document view that runs the Single's Save, so the save is
 * the one every surface uses. A value the server normalised must become what
 * the form shows and starts from; the stored document arriving back as the
 * editor's own document must not wipe typing done since; and a version nobody
 * here saved — a restore — resets the form, as Restore warns it will.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";

const { useDocumentLock } = vi.hoisted(() => ({ useDocumentLock: vi.fn() }));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));

import { useHostedDocumentActions } from "../../entries/EntryForm/DocumentActionsContext";
import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const VIEW = "@acme/pb/admin#Editor";
const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "heroTitle", label: "Hero Title" },
    { type: "text", name: "tagline", label: "Tagline" },
  ],
} as unknown as SingleSchema;
const first = {
  id: "homepage",
  updatedAt: "2026-10-17T12:00:00.000Z",
  heroTitle: "Welcome",
  tagline: "Short",
} as unknown as SingleDocumentData;

function EditorView(): ReactElement {
  const { register } = useFormContext();
  const { run } = useHostedDocumentActions();
  return (
    <div>
      <input aria-label="Hero heading" {...register("heroTitle")} />
      <input aria-label="Tagline" {...register("tagline")} />
      <button
        type="button"
        onClick={() => {
          void run("save");
        }}
      >
        Save from the view
      </button>
    </div>
  );
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

function renderSingle(
  onSubmit: ComponentProps<typeof SingleForm>["onSubmit"],
  document: SingleDocumentData = first
) {
  const view = (doc: SingleDocumentData) => (
    <SingleForm
      schema={schema}
      document={doc}
      onSubmit={onSubmit}
      documentView={{ component: VIEW, onExit: vi.fn() }}
    />
  );
  const rendered = render(view(document), { wrapper: Providers });
  return {
    rerenderWith: (doc: SingleDocumentData) => rendered.rerender(view(doc)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  registerComponent(VIEW, EditorView);
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  clearRegistry();
});

describe("a Single's form after a save", () => {
  it("shows and starts from what the server stored", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((sent: Record<string, unknown>) =>
      Promise.resolve({
        ...first,
        ...sent,
        heroTitle: String(sent.heroTitle).trim(),
        updatedAt: "2026-10-17T12:05:00.000Z",
      } as unknown as SingleDocumentData)
    );
    renderSingle(onSubmit);
    const heading = screen.getByLabelText("Hero heading");
    await user.clear(heading);
    await user.type(heading, "  Hello  ");

    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );

    await waitFor(() => expect(heading).toHaveValue("Hello"));
  });

  it("keeps typing done since, when its own stored document comes back, and resets to a restore", async () => {
    const user = userEvent.setup();
    const stored = {
      ...first,
      heroTitle: "Saved",
      updatedAt: "2026-10-17T12:05:00.000Z",
    } as unknown as SingleDocumentData;
    const onSubmit = vi.fn(() => Promise.resolve(stored));
    const { rerenderWith } = renderSingle(onSubmit);
    const heading = screen.getByLabelText("Hero heading");
    await user.clear(heading);
    await user.type(heading, "Saved");
    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const tagline = screen.getByLabelText("Tagline");
    await user.clear(tagline);
    await user.type(tagline, "Typed since");
    // The stored document arriving back as the editor's own document.
    act(() => {
      rerenderWith(stored);
    });
    expect(tagline).toHaveValue("Typed since");

    // A restored version nobody here saved.
    act(() => {
      rerenderWith({
        ...first,
        tagline: "Restored",
        updatedAt: "2026-10-17T12:09:00.000Z",
      } as unknown as SingleDocumentData);
    });
    expect(tagline).toHaveValue("Restored");
  });
});
