/**
 * A Single that fails to load says so in the server's own words.
 *
 * The server's message already says what went wrong ("You can't see Home.",
 * "Not found."), so the page shows it as it is rather than putting "Failed to
 * load Single:" in front of it. The data hooks are replaced; the page's error
 * branch is the code under test.
 *
 * @module pages/dashboard/singles/[slug]/load-error.test
 */

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import { renderWithProviders } from "../../../../__tests__/utils";

type Query = { data: unknown; isLoading: boolean; error: Error | null };

let schemaQuery: Query;
let documentQuery: {
  document: unknown;
  isLoading: boolean;
  error: Error | null;
  sourceDoc: unknown;
  isNonDefaultLocale: boolean;
};

vi.mock("@admin/hooks/queries/useSingles", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/hooks/queries/useSingles")>();
  return {
    ...actual,
    useSingleSchema: () => schemaQuery,
    useUpdateSingleDocument: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});
vi.mock("@admin/hooks/queries/useSingleEditorDocument", () => ({
  useSingleEditorDocument: () => documentQuery,
}));
vi.mock("@admin/components/features/releases/ScheduledReleaseBanner", () => ({
  ScheduledReleaseBanner: () => null,
}));
vi.mock("@admin/components/features/releases/AddToReleaseAction", () => ({
  useAddToReleaseAction: () => ({ dialog: null, contributed: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: undefined, enabled: false }),
}));
vi.mock("@admin/hooks/useEditorLocale", () => ({
  useEditorLocale: () => ({
    locale: undefined,
    changeLocale: vi.fn(),
    resetLocale: vi.fn(),
    seedFromLocale: vi.fn(),
    clearSeed: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/useTranslationMode", () => ({
  useTranslationMode: () => ({
    translateFrom: undefined,
    enterTranslationMode: vi.fn(),
    exitTranslationMode: vi.fn(),
  }),
}));

import SingleEditPage from "./index";

const REFUSAL = "You can't see Home.";

beforeEach(() => {
  schemaQuery = { data: undefined, isLoading: false, error: null };
  documentQuery = {
    document: undefined,
    isLoading: false,
    error: null,
    sourceDoc: undefined,
    isNonDefaultLocale: false,
  };
});

describe("a Single that fails to load", () => {
  it("shows the server's message for the document as it is", () => {
    documentQuery.error = parseApiError(
      { error: { code: "FORBIDDEN", message: REFUSAL, requestId: "r1" } },
      403
    );

    renderWithProviders(<SingleEditPage params={{ slug: "home" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      new RegExp(`^${REFUSAL}$`)
    );
  });

  it("shows the server's message for the schema as it is", () => {
    schemaQuery.error = parseApiError(
      { error: { code: "NOT_FOUND", message: "Not found.", requestId: "r2" } },
      404
    );

    renderWithProviders(<SingleEditPage params={{ slug: "home" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/^Not found\.$/);
  });
});
