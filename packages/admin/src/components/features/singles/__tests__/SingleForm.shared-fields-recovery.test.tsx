/**
 * What a Single's form gives the recovery from a publish refused over shared
 * values someone else published since.
 *
 * A failed save hands the page the form as well as the values it sent, so the
 * recovery can save the form as it is when the action is taken, since the
 * author may have kept editing. And once the live values are taken the form
 * has to show them: the reloaded Single has the same identity as the one on
 * screen, so the form would not reset, and the next Publish would send the
 * stale value and put it back live.
 *
 * Driven through a document view that runs the Single's Save, so the save is
 * the one every surface uses.
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
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";
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
  updatedAt: "2026-10-22T09:00:00.000Z",
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

function renderSingle(onSubmit: ComponentProps<typeof SingleForm>["onSubmit"]) {
  const view = (doc: SingleDocumentData) => (
    <SingleForm
      schema={schema}
      document={doc}
      onSubmit={onSubmit}
      documentView={{ component: VIEW, onExit: vi.fn() }}
    />
  );
  const rendered = render(view(first), { wrapper: Providers });
  return {
    rerenderWith: (doc: SingleDocumentData) => rendered.rerender(view(doc)),
  };
}

/** A save the server refuses, then saves that succeed. */
function refusedOnce() {
  return vi
    .fn<ComponentProps<typeof SingleForm>["onSubmit"]>()
    .mockRejectedValueOnce(new Error("Shared values were published"))
    .mockResolvedValue(undefined);
}

/** The form the page was handed with the refused save. */
function refusedFormOf(
  onSubmit: ReturnType<typeof refusedOnce>
): RefusedForm | undefined {
  return (onSubmit.mock.calls[0] as unknown[])[1] as RefusedForm | undefined;
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

describe("a Single's form, for a publish refused over shared values", () => {
  it("gives the recovery its values as they are when the action is taken", async () => {
    const user = userEvent.setup();
    const onSubmit = refusedOnce();
    renderSingle(onSubmit);
    const heading = screen.getByLabelText("Hero heading");
    await user.clear(heading);
    await user.type(heading, "Refused");
    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Edited after the refusal, before the action is taken.
    const tagline = screen.getByLabelText("Tagline");
    await user.clear(tagline);
    await user.type(tagline, "Typed after");

    const values = await refusedFormOf(onSubmit)?.pendingChangeNow();
    expect(values).toMatchObject({
      heroTitle: "Refused",
      tagline: "Typed after",
    });
    expect(values).not.toHaveProperty("status");
  });

  it("shows the live value of a taken field, keeps every other edit, and saves the live value next", async () => {
    const user = userEvent.setup();
    const onSubmit = refusedOnce();
    const { rerenderWith } = renderSingle(onSubmit);
    const heading = screen.getByLabelText("Hero heading");
    const tagline = screen.getByLabelText("Tagline");
    await user.clear(heading);
    await user.type(heading, "Stale");
    await user.clear(tagline);
    await user.type(tagline, "Mine");
    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    act(() => {
      refusedFormOf(onSubmit)?.adoptTaken(["heroTitle"]);
    });
    // Typed while the live values were being taken: newer than anything the
    // reloaded Single carries.
    await user.clear(tagline);
    await user.type(tagline, "Later");
    // The reloaded Single: the live heading taken into the change, the same
    // identity as the one on screen, and the tagline as it was saved, before
    // the edit above.
    act(() => {
      rerenderWith({
        ...first,
        heroTitle: "Live",
        tagline: "Mine",
      } as unknown as SingleDocumentData);
    });

    // Only the field taken is reset; a reset of the whole form would put the
    // saved "Mine" back over the edit made since.
    expect(heading).toHaveValue("Live");
    expect(tagline).toHaveValue("Later");

    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({
      heroTitle: "Live",
      tagline: "Later",
    });
  });
});
