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
 * bar's "Move", and the file drop area's browse hint. The links among them
 * are underlined at rest, so they read as links without the brand's colour.
 *
 * @module components/__tests__/small-links-text-colour.test
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

// One client for every render, as the admin's own is: the sign-in page reads
// its extras again whenever the client changes, so a client made per render
// would ask again on every answer.
const { get, post, client } = vi.hoisted(() => {
  const get = vi.fn();
  const post = vi.fn();
  return { get, post, client: { api: { public: { get, post } } } };
});
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/hooks/useApi", () => ({ useApi: () => client }));
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

/**
 * A link that reads in the text colour beside other text shows it is a link
 * by more than its colour: underlined at rest.
 */
function expectUnderlined(element: Element): void {
  expect(classesOf(element)).toContain("underline");
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
    const forgot = await screen.findByRole("link", {
      name: "Forgot password?",
    });
    expectTextColour(forgot);
    expectUnderlined(forgot);
    // Settled, not still asking: one client for every render, so the
    // answer's own render starts no second read.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(get.mock.calls.filter(([path]) => path === "/auth/ui")).toHaveLength(
      1
    );
  });

  it("Launch Initial Entry on the content widget with no content yet", () => {
    stats.current = {
      data: { status: { published: 0, draft: 0 } },
      isLoading: false,
      error: null,
    };
    render(<ContentStatusWidget />);
    const launch = screen.getByRole("link", { name: /Launch Initial Entry/ });
    expectTextColour(launch);
    expectUnderlined(launch);
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
