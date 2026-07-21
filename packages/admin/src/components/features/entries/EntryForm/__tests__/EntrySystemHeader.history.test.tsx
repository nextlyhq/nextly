/**
 * The history control is offered only when there is history to look at and a
 * schema to render it with. Offering it otherwise leads to a panel that can
 * only report emptiness or fail.
 */
import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { sheetMock } = vi.hoisted(() => ({ sheetMock: vi.fn() }));

vi.mock("@admin/components/features/versions/VersionHistorySheet", () => ({
  VersionHistorySheet: (props: Record<string, unknown>) => {
    sheetMock(props);
    return null;
  },
}));

import { EntrySystemHeader } from "../EntrySystemHeader";

/**
 * The header reads form state through context, so it is given a real form
 * rather than a stubbed one — a partial stub misses the ref plumbing that
 * `register` returns and fails for reasons unrelated to what is under test.
 */
function WithForm({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

const fields = [{ name: "title", type: "text" }] as FieldConfig[];

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    <WithForm>
      <EntrySystemHeader
        mode="edit"
        hasStatus={false}
        collectionSlug="posts"
        entry={{ id: "e1" } as never}
        historyFields={fields}
        isSubmitting={false}
        isDirty={false}
        {...overrides}
      />
    </WithForm>
  );
}

describe("EntrySystemHeader version history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers history for a saved document", () => {
    renderHeader();

    expect(
      screen.getByRole("button", { name: "Version history" })
    ).toBeInTheDocument();
  });

  it("does not offer history for a document that was never saved", () => {
    // A create form has no entry id, so there is nothing to have history of.
    renderHeader({ mode: "create", entry: null });

    expect(
      screen.queryByRole("button", { name: "Version history" })
    ).not.toBeInTheDocument();
  });

  it("does not offer history without a schema to render it with", () => {
    renderHeader({ historyFields: undefined });

    expect(
      screen.queryByRole("button", { name: "Version history" })
    ).not.toBeInTheDocument();
  });

  it("does not offer history for an entity that records no versions", () => {
    // Writes only capture a snapshot when versioning is enabled, so offering
    // history elsewhere leads to a panel that can never fill.
    renderHeader({ historyEnabled: false });

    expect(
      screen.queryByRole("button", { name: "Version history" })
    ).not.toBeInTheDocument();
  });

  it("still offers history when the setting could not be determined", () => {
    // Hiding on an absent flag would silently remove the feature wherever the
    // schema payload omits it.
    renderHeader({ historyEnabled: undefined });

    expect(
      screen.getByRole("button", { name: "Version history" })
    ).toBeInTheDocument();
  });

  it("addresses a collection entry by its id", () => {
    renderHeader();

    expect(sheetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "collection", slug: "posts", entryId: "e1" },
      })
    );
  });

  it("addresses a Single by slug alone", () => {
    // A Single has one document and the server resolves its id, so no entry id
    // is sent even though the header has one.
    renderHeader({ scope: "single", collectionSlug: "settings" });

    // The document id travels for cache identity only, so a recreated Single
    // cannot be served its predecessor's cached history.
    expect(sheetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "single", slug: "settings", documentId: "e1" },
      })
    );
  });
});
