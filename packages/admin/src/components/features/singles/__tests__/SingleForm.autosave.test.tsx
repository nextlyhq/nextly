/**
 * The Single editor must autosave too.
 *
 * Entries and Singles are two separate form owners with different shapes -- the
 * entry editor holds its own mutation, this one receives `onSubmit` as a prop --
 * so wiring one and forgetting the other is the standing failure mode here, and
 * the two pages look identical to an author. This asserts the Single side calls
 * the endpoint under its OWN scope, which is what a copy-paste from the entry
 * wiring would get wrong.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const versionApiMock = vi.hoisted(() => ({
  autosave: vi.fn().mockResolvedValue({ message: "ok" }),
  // The recovery read the editor makes on open. Null: these tests are about
  // the write path, and an offered snapshot would replace the form values.
  getAutosave: vi.fn().mockResolvedValue(null),
}));

vi.mock("@admin/services/versionApi", () => ({ versionApi: versionApiMock }));

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "title", label: "Title", required: true },
    { type: "text", name: "slug", label: "Slug", required: true, unique: true },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  heroTitle: "",
} as unknown as SingleDocumentData;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SingleForm autosave", () => {
  it("stores a recovery point under the single scope after an edit", async () => {
    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("Hero Title"), {
      target: { value: "a draft headline" },
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(versionApiMock.autosave).toHaveBeenCalledTimes(1);
    const [scope, snapshot] = versionApiMock.autosave.mock.calls[0] ?? [];
    // `kind: "single"` is the part a copy of the entry wiring gets wrong, and
    // it decides the URL: a Single's history carries no entry id.
    expect(scope).toEqual({
      kind: "single",
      slug: "homepage",
      documentId: "homepage",
    });
    expect(snapshot).toMatchObject({ heroTitle: "a draft headline" });
  });
});
