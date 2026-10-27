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
  fireEvent,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";
import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";

const { useDocumentLock, autosaveOffer } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  // A recovery point the editor offers back, when a test sets one.
  autosaveOffer: {
    current: null as { savedAt: Date; snapshot: unknown } | null,
  },
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  // As the hook does: an offer is withdrawn once a save lands, which the
  // editor reports through `savedCount` (see the hook's own tests).
  useAutosaveRecovery: ({ savedCount = 0 }: { savedCount?: number }) => ({
    offer: savedCount > 0 ? null : autosaveOffer.current,
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
  autosaveOffer.current = null;
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

  it("starts the form afresh from the reloaded Single, so it shows the live value and saves it next", async () => {
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

    // The reloaded Single: the saved change with the live heading taken into
    // it, under the same key as the one on screen, which the Single's own
    // reset would leave alone. Handed over as React Query does, a task after
    // the reload settles.
    await refusedFormOf(onSubmit)?.run(async () => {
      setTimeout(() => {
        act(() => {
          rerenderWith({
            ...first,
            heroTitle: "Live",
            tagline: "Mine",
          } as unknown as SingleDocumentData);
        });
      }, 0);
    });

    await waitFor(() => expect(heading).toHaveValue("Live"));
    expect(tagline).toHaveValue("Mine");

    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({
      heroTitle: "Live",
      tagline: "Mine",
    });
  });
  it("takes the live values that arrive after the recovery, under the same key, into its clean form", async () => {
    const onSubmit = refusedOnce();
    const { rerenderWith } = renderSingle(onSubmit);
    const heading = screen.getByLabelText("Hero heading");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Save from the view" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // The recovery finishes and starts the form afresh before the merged
    // Single settles; it arrives a little later, under the same key.
    await act(async () => {
      await refusedFormOf(onSubmit)?.run(async () => undefined);
    });
    act(() => {
      rerenderWith({
        ...first,
        heroTitle: "Live",
      } as unknown as SingleDocumentData);
    });

    expect(heading).toHaveValue("Live");
  });
  it("won't run the recovery once another author holds the Single", async () => {
    const user = userEvent.setup();
    const onSubmit = refusedOnce();
    const { rerenderWith } = renderSingle(onSubmit);
    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Someone else takes the Single after the refusal; the toast still offers
    // the action, so the action itself has to ask.
    useDocumentLock.mockReturnValue({
      state: {
        status: "held-by-other",
        holder: { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 },
      },
      takeOver: vi.fn(),
      requestAccess: vi.fn(),
    });
    act(() => {
      rerenderWith(first);
    });

    const work = vi.fn(async () => undefined);
    await expect(refusedFormOf(onSubmit)?.run(work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it("holds the Single's own saves while the recovery runs", async () => {
    const user = userEvent.setup();
    const onSubmit = refusedOnce();
    renderSingle(onSubmit);
    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Made before the recovery starts, which runs its work a task later.
    let done: () => void = () => {};
    const held = new Promise<void>(resolve => {
      done = resolve;
    });
    const running = refusedFormOf(onSubmit)?.run(() => held);
    await user.click(
      screen.getByRole("button", { name: "Save from the view" })
    );
    // Nothing written while the recovery holds the gate.
    expect(onSubmit).toHaveBeenCalledTimes(1);

    done();
    await running;
  });

  it.each([
    ["succeeds", (finish: Finish) => finish.resolve()],
    ["fails", (finish: Finish) => finish.reject(new Error("offline"))],
  ])(
    "holds the Single's fields read-only while the recovery runs, and gives them back once it %s",
    async (_outcome, settle) => {
      const onSubmit = refusedOnce();
      // The Single's own fields, not a document view.
      const { container } = render(
        <SingleForm schema={schema} document={first} onSubmit={onSubmit} />,
        { wrapper: Providers }
      );
      const hero = screen.getByRole("textbox", { name: "Hero Title" });
      fireEvent.submit(container.querySelector("form") as HTMLFormElement);
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(hero).not.toHaveAttribute("readonly");
      expect(writeControls().some(control => !control.disabled)).toBe(true);

      // Made before the recovery starts, which runs its work a task later.
      const finish = {} as Finish;
      const held = new Promise<void>((resolve, reject) => {
        finish.resolve = resolve;
        finish.reject = reject;
      });
      // Its rejection reaches the recovery once it runs the work; marked as
      // handled here, since it may be rejected before then.
      held.catch(() => undefined);
      let running: Promise<unknown> | undefined;
      act(() => {
        running = refusedFormOf(onSubmit)
          ?.run(() => held)
          .catch(() => undefined);
      });

      // Read-only, not disabled, so a field keeps focus.
      expect(hero).toHaveAttribute("readonly");
      expect(hero).not.toBeDisabled();
      expect(hero.closest("form")).toHaveAttribute("aria-busy", "true");
      // And so is every write the document offers.
      for (const control of writeControls()) {
        expect(control, control.textContent ?? "").toBeDisabled();
      }

      await act(async () => {
        settle(finish);
        await running;
      });

      expect(hero).not.toHaveAttribute("readonly");
      expect(hero.closest("form")).not.toHaveAttribute("aria-busy");
      expect(writeControls().some(control => !control.disabled)).toBe(true);
    }
  );

  it("withholds an autosave recovery point while the recovery runs", async () => {
    // Restoring one writes into the form the recovery holds.
    autosaveOffer.current = { savedAt: new Date(), snapshot: {} };
    const onSubmit = refusedOnce();
    const { container } = render(
      <SingleForm schema={schema} document={first} onSubmit={onSubmit} />,
      { wrapper: Providers }
    );
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();

    // Made before the recovery starts, which runs its work a task later.
    let done: () => void = () => {};
    const held = new Promise<void>(resolve => {
      done = resolve;
    });
    let running: Promise<unknown> | undefined;
    act(() => {
      running = refusedFormOf(onSubmit)?.run(() => held);
    });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();

    await act(async () => {
      done();
      await running;
    });
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("withdraws an autosave recovery point the recovery's save made stale, so Restore can't bring the old values back", async () => {
    autosaveOffer.current = { savedAt: new Date(), snapshot: {} };
    const onSubmit = refusedOnce();
    const { container } = render(
      <SingleForm schema={schema} document={first} onSubmit={onSubmit} />,
      { wrapper: Providers }
    );
    const formBefore = container.querySelector("form");
    fireEvent.submit(formBefore as HTMLFormElement);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();

    await act(async () => {
      await refusedFormOf(onSubmit)?.run(async () => {
        refusedFormOf(onSubmit)?.saved();
      });
    });

    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    // The same editor throughout, never remounted, so its claim stands.
    expect(container.querySelector("form")).toBe(formBefore);
  });
});

/** The document's Save and Publish controls, wherever they are drawn. */
function writeControls(): HTMLButtonElement[] {
  return screen.getAllByRole("button", {
    name: /save|publish/i,
  }) as HTMLButtonElement[];
}

interface Finish {
  resolve: () => void;
  reject: (error: Error) => void;
}
