/**
 * The Single page with changes from a last visit on offer.
 *
 * A view whose own save chip makes the offer lets Save keep those changes
 * (restore, then save). The Single page makes the offer in a banner instead,
 * and none of that applies to it: the banner is drawn, the chip says
 * "Unsaved changes", and its Save stores the form as it stands, never the
 * recovery point.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import type { RestoreOutcome } from "@admin/hooks/useAutosaveRecovery";

const { useDocumentLock, restoreChecked } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(() => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  })),
  restoreChecked: vi.fn(
    (_apply?: () => void): Promise<RestoreOutcome> =>
      Promise.resolve("restored")
  ),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: {
      savedAt: new Date(),
      snapshot: { heroTitle: "Recovered" },
      olderVersion: false,
      startingVersionUnknown: false,
    },
    isResolved: true,
    dismiss: vi.fn(),
    restore: vi.fn(),
    restoreChecked,
    take: vi.fn(),
    recheck: vi.fn(),
  }),
}));

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [{ type: "text", name: "heroTitle", label: "Hero Title" }],
} as unknown as SingleSchema;
const singleDocument = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  heroTitle: "Welcome",
} as unknown as SingleDocumentData;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

afterEach(cleanup);

describe("the Single page with changes from a last visit on offer", () => {
  it("keeps its banner and its chip's words, and its Save never restores them", async () => {
    const onSubmit = vi.fn(
      async (_data: Record<string, unknown>): Promise<void> => undefined
    );
    render(
      <SingleForm
        schema={schema}
        document={singleDocument}
        onSubmit={onSubmit}
      />,
      {
        wrapper: Providers,
      }
    );

    expect(
      screen.getByText(/you have unsaved changes from/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Unsaved changes: Save or Discard" })
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      heroTitle: "Welcome",
    });
    expect(restoreChecked).not.toHaveBeenCalled();
  });
});
