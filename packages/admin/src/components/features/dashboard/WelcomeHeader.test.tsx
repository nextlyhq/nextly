/**
 * The dashboard keeps exactly one level-one heading in every state.
 *
 * The heading is the page's landmark for screen-reader and keyboard users:
 * jumping by heading lands on it, and every card title (an `h2`) sits under it
 * in the outline. It used to vanish while the sample-content card was the
 * page's call to action and while the signed-in user was still loading, which
 * is what a first visit paints first. Sample content is now a step of the
 * setup card, which draws no heading of its own (`SetupCard.test.tsx`), so
 * these render the header against each state of the user read.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardSummary } from "@admin/types/dashboard/summary";

type UserRead = {
  user: { id: string; name: string; email: string } | null;
  isLoading: boolean;
  error: Error | null;
};
let userRead: UserRead = { user: null, isLoading: true, error: null };
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => userRead,
}));

let summaryRead: { data: DashboardSummary | undefined; isError?: boolean } = {
  data: undefined,
};
vi.mock("@admin/hooks/queries/useDashboardSummary", () => ({
  useDashboardSummary: () => summaryRead,
}));

// Whether the reader's dismissed setup card can come back, as a case sets it;
// the read and the write behind it are `ResumeSetupLink.test.tsx`'s.
const setupResume = vi.hoisted(() => ({
  resumable: false,
  resume: vi.fn(),
  isResuming: false,
  failed: false,
}));
vi.mock("./setup/useSetupResume", () => ({
  useSetupResume: () => setupResume,
}));

let appName = "Acme Site";
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useAppName: () => appName,
}));

import { CELL_PLACEMENT_ATTRIBUTE } from "../widgets/edit/drag/useCardDrag";

import {
  DashboardChromeProvider,
  usePublishDashboardChrome,
  type DashboardChromeState,
} from "./header/dashboard-chrome";
import { greetingFor, WelcomeHeader } from "./WelcomeHeader";

const USER_STATES: Array<[string, UserRead]> = [
  ["the user still loading", { user: null, isLoading: true, error: null }],
  [
    "the user loaded",
    {
      user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
      isLoading: false,
      error: null,
    },
  ],
  [
    "the user read failed",
    { user: null, isLoading: false, error: new Error("network") },
  ],
];

/** The top of the dashboard: its header. */
function renderDashboardTop() {
  return render(<WelcomeHeader />);
}

afterEach(() => {
  userRead = { user: null, isLoading: true, error: null };
  summaryRead = { data: undefined };
  appName = "Acme Site";
  setupResume.resumable = false;
  setupResume.resume.mockReset();
});

describe("the dashboard's main heading", () => {
  for (const [userLabel, user] of USER_STATES) {
    it(`is the one level-one heading with ${userLabel}`, () => {
      userRead = user;
      renderDashboardTop();

      const mains = screen.getAllByRole("heading", { level: 1 });
      expect(mains).toHaveLength(1);
      const main = mains[0]!;

      // Card titles sit below it in the outline: each comes after it in the
      // document, and none is another level-one heading.
      for (const title of screen.queryAllByRole("heading", { level: 2 })) {
        expect(
          main.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      }
    });
  }

  it("is the project's name, before the person is known and after", () => {
    // The first paint of a first visit: nothing has answered yet. A heading
    // with an empty accessible name is skipped by screen readers' heading
    // lists, so present is not enough.
    renderDashboardTop();
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Site" })
    ).toBeInTheDocument();
    cleanup();
    userRead = USER_STATES[1]![1];
    renderDashboardTop();
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Site" })
    ).toBeInTheDocument();
  });
});

/** What a grid would publish: here, the state a test names. */
function Grid({ state }: { state: Partial<DashboardChromeState> }) {
  usePublishDashboardChrome(
    {
      customizable: true,
      editing: false,
      writing: false,
      oldestAnswerAt: null,
      cards: {},
      ...state,
    },
    { begin: () => {}, refresh: () => {}, customizeRef: () => {} }
  );
  return null;
}

function renderHeader(state?: Partial<DashboardChromeState>) {
  return render(
    <DashboardChromeProvider>
      <WelcomeHeader />
      {state === undefined ? null : <Grid state={state} />}
    </DashboardChromeProvider>
  );
}

describe("the dashboard header", () => {
  it("draws the greeting, the project's name, the summary, then Customize, and no tagline", () => {
    userRead = USER_STATES[1]![1];
    summaryRead = {
      data: { parts: [{ kind: "attention", count: 2 }], failed: 0 },
    };
    renderHeader({});
    const header = screen.getByTestId("dashboard-header");
    const order = [
      screen.getByTestId("dashboard-greeting"),
      screen.getByRole("heading", { level: 1 }),
      screen.getByTestId("dashboard-summary"),
      screen.getByTestId("dashboard-edit-begin"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(header).not.toHaveTextContent("Manage your content");
  });

  it("greets by the reader's own hour and first name, and says Welcome without one", () => {
    expect(greetingFor("Ada Lovelace", new Date(2026, 9, 28, 9))).toBe(
      "Good morning, Ada"
    );
    expect(greetingFor("Ada", new Date(2026, 9, 28, 14))).toBe(
      "Good afternoon, Ada"
    );
    expect(greetingFor("Ada", new Date(2026, 9, 28, 20))).toBe(
      "Good evening, Ada"
    );
    expect(greetingFor(null, new Date())).toBe("Welcome");
    expect(greetingFor("  ", new Date())).toBe("Welcome");
  });

  it("shows the environment the site names, in its tone, beside the name and not in it", () => {
    summaryRead = {
      data: {
        parts: [],
        failed: 0,
        environment: { label: "Staging", tone: "warning" },
      },
    };
    renderHeader();
    const badge = screen.getByTestId("dashboard-environment");
    expect(badge).toHaveTextContent("Staging");
    expect(badge).toHaveAttribute("data-tone", "warning");
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Site" })
    ).toBeInTheDocument();
  });

  it("shows no badge where the site names no environment", () => {
    summaryRead = { data: { parts: [], failed: 0 } };
    renderHeader();
    expect(screen.queryByTestId("dashboard-environment")).toBeNull();
  });

  it("offers Customize only where the grid lets the reader customise, and not while customising", () => {
    renderHeader();
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
    cleanup();
    renderHeader({ customizable: false });
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
    cleanup();
    renderHeader({ customizable: true, editing: true });
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
    cleanup();
    renderHeader({ customizable: true, writing: true });
    expect(screen.getByTestId("dashboard-edit-begin")).toBeDisabled();
  });

  it("says all caught up only when every part was read, and nothing when a part failed", () => {
    summaryRead = { data: { parts: [], failed: 0 } };
    renderHeader();
    expect(screen.getByTestId("dashboard-summary")).toHaveTextContent(
      "You're all caught up"
    );
    cleanup();
    summaryRead = { data: { parts: [], failed: 1 } };
    renderHeader();
    expect(screen.queryByTestId("dashboard-summary")).toBeNull();
    cleanup();
    summaryRead = {
      data: { parts: [{ kind: "attention", count: 2 }], failed: 1 },
    };
    renderHeader();
    const line = screen.getByTestId("dashboard-summary");
    expect(line).toHaveTextContent("2 things need you");
    expect(line).not.toHaveTextContent("caught up");
  });

  it("joins the parts with a middle dot, each a link", () => {
    summaryRead = {
      data: {
        parts: [
          { kind: "attention", count: 2, link: "releases" },
          {
            kind: "widget",
            widget: "acme/forms",
            card: "c1",
            label: "new submissions",
            count: 3,
          },
        ],
        failed: 0,
      },
    };
    renderHeader({ cards: { "acme/forms": ["c1"] } });
    const line = screen.getByTestId("dashboard-summary");
    expect(line).toHaveTextContent("2 things need you · 3 new submissions");
    expect(within(line).getByRole("link")).toHaveTextContent(
      "2 things need you"
    );
    expect(within(line).getByRole("button")).toHaveTextContent(
      "3 new submissions"
    );
  });

  it("draws a part with no list and no card on the dashboard as words, not a control", () => {
    summaryRead = {
      data: { parts: [{ kind: "attention", count: 2 }], failed: 0 },
    };
    renderHeader({});
    const line = screen.getByTestId("dashboard-summary");
    expect(line).toHaveTextContent("2 things need you");
    expect(within(line).queryByRole("button")).toBeNull();
    expect(within(line).queryByRole("link")).toBeNull();
  });

  it("words nothing from an earlier answer once a later read of it failed", () => {
    // A failed refetch keeps the last answer: its counts, or its "caught up",
    // are no longer known to be true.
    summaryRead = { data: { parts: [], failed: 0 }, isError: true };
    renderHeader();
    expect(screen.queryByTestId("dashboard-summary")).toBeNull();
    cleanup();
    summaryRead = {
      data: { parts: [{ kind: "attention", count: 2 }], failed: 0 },
      isError: true,
    };
    renderHeader();
    expect(screen.queryByTestId("dashboard-summary")).toBeNull();
    cleanup();
    // The control: the same answer, its latest read a success.
    summaryRead = { data: { parts: [], failed: 0 }, isError: false };
    renderHeader();
    expect(screen.getByTestId("dashboard-summary")).toHaveTextContent(
      "You're all caught up"
    );
  });

  it("ends the summary line with Resume setup while the dismissed card can come back, and resumes it when pressed", () => {
    setupResume.resumable = true;
    summaryRead = {
      data: { parts: [{ kind: "attention", count: 2 }], failed: 0 },
    };
    renderHeader({});
    const line = screen.getByTestId("dashboard-summary");
    expect(line).toHaveTextContent("2 things need you · Resume setup");
    const resume = within(line).getByRole("button", { name: "Resume setup" });
    // The line's last control: after every part, not among them.
    expect(line.lastElementChild).toBe(resume);
    fireEvent.click(resume);
    expect(setupResume.resume).toHaveBeenCalledTimes(1);
  });

  it("offers Resume setup on a line of its own words when the summary says nothing", () => {
    // 🔴 Drawn only inside a worded line, the way back to a dismissed card
    // vanished while the summary loaded or a part of it failed.
    setupResume.resumable = true;
    summaryRead = { data: { parts: [], failed: 1 } };
    renderHeader();
    expect(screen.getByTestId("dashboard-summary")).toHaveTextContent(
      /^Resume setup$/
    );
  });

  it("offers no Resume setup when the card cannot come back", () => {
    summaryRead = {
      data: { parts: [{ kind: "attention", count: 2 }], failed: 0 },
    };
    renderHeader({});
    expect(screen.getByTestId("dashboard-summary")).not.toHaveTextContent(
      "Resume setup"
    );
    cleanup();
    summaryRead = { data: { parts: [], failed: 1 } };
    renderHeader();
    expect(screen.queryByTestId("dashboard-summary")).toBeNull();
  });

  it("says how old the data is only past five minutes, once, with Refresh", () => {
    renderHeader({ oldestAnswerAt: Date.now() - 4 * 60_000 });
    expect(screen.queryByTestId("dashboard-freshness")).toBeNull();
    cleanup();
    renderHeader({ oldestAnswerAt: Date.now() - 7 * 60_000 });
    expect(screen.getByTestId("dashboard-freshness")).toHaveTextContent(
      "Updated 7 min ago · Refresh"
    );
    expect(screen.getAllByTestId("dashboard-freshness")).toHaveLength(1);
  });
});

/** A card drawn on the dashboard, as the grid draws one: focusable, by its placement id. */
function drawnCard(placementId: string): HTMLElement {
  const card = document.createElement("div");
  card.setAttribute(CELL_PLACEMENT_ATTRIBUTE, placementId);
  card.tabIndex = -1;
  card.scrollIntoView = vi.fn();
  document.body.append(card);
  return card;
}

describe("following a summary part to its card", () => {
  afterEach(() => {
    for (const card of document.querySelectorAll(
      `[${CELL_PLACEMENT_ATTRIBUTE}]`
    )) {
      card.remove();
    }
  });

  const widgetPart = (card: string): DashboardSummary => ({
    parts: [
      {
        kind: "widget",
        widget: "acme/forms",
        card,
        label: "new submissions",
        count: 3,
      },
    ],
    failed: 0,
  });

  it("focuses the very card the part names, not its widget's first", () => {
    // The widget's first card is not shown to this reader, so it is not drawn;
    // the server named the one that is.
    const shown = drawnCard("c2");
    summaryRead = { data: widgetPart("c2") };
    renderHeader({ cards: { "acme/forms": ["c1", "c2"] } });

    fireEvent.click(screen.getByTestId("dashboard-summary-widget:acme/forms"));

    expect(document.activeElement).toBe(shown);
  });

  it("draws a part whose card is not on the dashboard as words", () => {
    summaryRead = { data: widgetPart("c3") };
    renderHeader({ cards: { "acme/forms": ["c1", "c2"] } });
    const line = screen.getByTestId("dashboard-summary");
    expect(line).toHaveTextContent("3 new submissions");
    expect(within(line).queryByRole("button")).toBeNull();
  });

  it("leaves a modified or non-primary click on a link to the browser", () => {
    const card = drawnCard("a1");
    summaryRead = {
      data: {
        parts: [{ kind: "attention", count: 2, link: "releases" }],
        failed: 0,
      },
    };
    renderHeader({ cards: { "core/needs-attention": ["a1"] } });
    const link = screen.getByRole("link", { name: "2 things need you" });

    for (const modified of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      // `fireEvent` answers false only when the click's default was prevented.
      expect(fireEvent.click(link, { button: 0, ...modified })).toBe(true);
      expect(document.activeElement).not.toBe(card);
    }
    // The control: a plain primary click follows to the card instead.
    expect(fireEvent.click(link, { button: 0 })).toBe(false);
    expect(document.activeElement).toBe(card);
  });
});
