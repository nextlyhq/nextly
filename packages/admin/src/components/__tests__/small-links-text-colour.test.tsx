/**
 * Small links and buttons read in the admin's text colour, not the brand's.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour: the e2e
 * suite's indigo reads under AA's 4.5:1 as small text on a light surface, so
 * small text drawn in it is only as readable as the brand happens to be.
 * Each of these is small text on a light surface, and reads in
 * `--nx-foreground`, which every theme and brand keeps readable:
 * "Forgot password?" on the sign-in page, the empty content widget's
 * "Launch Initial Entry", the stats grid's "Infrastructure", the media bulk
 * bar's "Move", and the file drop area's browse hint.
 *
 * @module components/__tests__/small-links-text-colour.test
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { get, post } } }),
}));
// What the dashboard's stats answer, set per test.
const stats = vi.hoisted(() => ({
  current: { data: undefined as unknown, isLoading: true, error: null },
}));
vi.mock("@admin/hooks/queries/useDashboardStats", () => ({
  useDashboardStats: () => stats.current,
}));

const { Login } = await import("../features/auth-login");
const { ContentStatusWidget } = await import(
  "../features/dashboard/ContentStatusWidget"
);
const { ProjectStatsGrid } = await import(
  "../features/dashboard/ProjectStatsGrid"
);
const { MediaBulkActionBar } = await import(
  "../features/media-library/MediaBulkActionBar"
);
const { FileDropArea } = await import("../ui/file-drop-area");

/** The element's own classes, as the stylesheet reads them. */
function classesOf(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

function expectTextColour(element: Element): void {
  const classes = classesOf(element);
  expect(classes).toContain("text-foreground");
  expect(classes).not.toContain("text-primary");
}

beforeEach(() => {
  stats.current = { data: undefined, isLoading: true, error: null };
  get.mockReset();
  post.mockReset();
  resetSetupStatusCache();
  get.mockImplementation(async (path: string) =>
    path === "/auth/setup-status"
      ? { isSetup: true, allowRegistration: false }
      : {
          providers: [],
          challengeViews: {},
          slots: { beforeForm: [], afterForm: [], branding: [] },
        }
  );
});

describe("small links read in the admin's text colour", () => {
  it("Forgot password? on the sign-in page", async () => {
    render(<Login />);
    expectTextColour(
      await screen.findByRole("link", { name: "Forgot password?" })
    );
  });

  it("Launch Initial Entry on the content widget with no content yet", () => {
    stats.current = {
      data: { status: { published: 0, draft: 0 } },
      isLoading: false,
      error: null,
    };
    render(<ContentStatusWidget />);
    expectTextColour(
      screen.getByRole("link", { name: /Launch Initial Entry/ })
    );
  });

  it("Infrastructure on the stats grid", () => {
    render(<ProjectStatsGrid />);
    expectTextColour(screen.getByRole("link", { name: /Infrastructure/ }));
  });

  it("Move on the media bulk bar", () => {
    render(
      <MediaBulkActionBar
        selectedCount={2}
        onDelete={vi.fn()}
        onMoveToFolder={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expectTextColour(screen.getByRole("button", { name: /Move/ }));
  });

  it("the file drop area's browse hint", () => {
    render(
      <FileDropArea
        onFiles={vi.fn()}
        label="Choose a file"
        title="Drop it"
        hint="or browse"
      />
    );
    expectTextColour(screen.getByText("or browse"));
  });
});
