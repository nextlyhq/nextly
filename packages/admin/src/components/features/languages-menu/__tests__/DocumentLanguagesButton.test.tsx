/**
 * The Languages button as an editor mounts it for a translated document: drawn on a site with
 * languages and on no other, leading to this document's own addresses, and offering only what
 * the person may do at this moment.
 *
 * Catches a button on a one-language site, a person left with no way to another
 * language because they may not read every language's state, and a publish offered over a past
 * version.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import {
  DocumentLanguagesButton,
  type DocumentLanguagesButtonProps,
} from "../DocumentLanguagesButton";

const { site, permissions, bar, review } = vi.hoisted(() => ({
  review: { state: vi.fn() },
  site: { languages: 2 },
  permissions: { held: [] as string[] },
  bar: { width: 1200 },
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: site.languages >= 2,
    locales: [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "es", label: "Spanish", rtl: false, fallbackLocale: [] },
    ].slice(0, site.languages),
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useCurrentUserPermissions")
  >()),
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => permissions.held.includes(slug),
  }),
}));
vi.mock("@admin/hooks/queries/useReviewState", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReviewState")
  >()),
  useReviewState: review.state,
}));
vi.mock(
  "@admin/components/layout/header/TopBarPlaces",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/layout/header/TopBarPlaces")
    >()),
    useTopBarWidth: () => bar.width,
  })
);

const EDITOR = "/admin/collections/posts/p1";
const PUBLISH = "Publish other languages…";
const MANAGE = "Manage languages…";

const document = {
  id: "p1",
  status: "published",
  _translations: {
    en: { translated: true, status: "published" },
    es: { translated: true, status: "published", pendingChange: true },
  },
};

const REVIEWED = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "p1",
} as const;

/** A document whose languages stand in these stages; null for one in none. */
function standsIn(stages: Record<string, string | null>) {
  review.state.mockReturnValue({
    data: {
      attached: true,
      review: {
        workflow: { slug: "review", label: "Review" },
        // The shared fields' part as well, which no row is for.
        parts: [
          { part: null, stage: "approved", stageLabel: "Approved" },
          ...Object.entries(stages).map(([part, stageLabel]) => ({
            part,
            stage: stageLabel === null ? null : "stage",
            stageLabel,
          })),
        ],
        mayPublishWithoutReview: false,
      },
    },
  });
}

const NOTHING_HELD = {
  viewingPastVersion: false,
  recovering: false,
  changeAwaiting: false,
  documentHeld: false,
};

function draw(props: Partial<DocumentLanguagesButtonProps> = {}) {
  return render(
    <DocumentLanguagesButton
      document={document}
      reviewed={REVIEWED}
      hasStatus
      editorPath={EDITOR}
      locale={undefined}
      translating={false}
      hold={NOTHING_HELD}
      onPublishOthers={undefined}
      panelMode="docked"
      {...props}
    />
  );
}

async function open(props: Partial<DocumentLanguagesButtonProps> = {}) {
  draw(props);
  await userEvent.click(screen.getByRole("button"));
  return screen.findByRole("menu");
}

const item = (menu: HTMLElement, name: RegExp | string) =>
  within(menu).queryByRole("menuitem", { name });

beforeEach(() => {
  site.languages = 2;
  permissions.held = [];
  bar.width = 1200;
  review.state.mockReset().mockReturnValue({ data: { attached: false } });
});

describe("the document's Languages button", () => {
  it("says each language's stage beside its status", async () => {
    standsIn({ es: "In review", en: "Drafting" });
    const menu = await open();
    expect(review.state).toHaveBeenCalledWith(REVIEWED);
    expect(
      item(menu, /^Spanish.*Live.*changes not published.*In review/)
    ).not.toBeNull();
    // The language on screen too, after what it says of itself.
    expect(item(menu, /^English.*Editing.*live.*Drafting/)).not.toBeNull();
  });

  it("says no stage of a language standing in none, nor the shared fields' own", async () => {
    standsIn({ es: null });
    const menu = await open();
    expect(item(menu, /^Spanish.*changes not published/)).not.toBeNull();
    expect(within(menu).queryByText(/Approved|stage/)).toBeNull();
  });

  it("says no stage where no workflow holds the document", async () => {
    const menu = await open();
    expect(item(menu, /^Spanish.*changes not published/)).not.toBeNull();
    expect(within(menu).queryByText(/review|Drafting|Approved/)).toBeNull();
  });

  it("says a stage to someone told no language's status", async () => {
    standsIn({ es: "In review" });
    const menu = await open({ document: { id: "p1", status: "published" } });
    expect(item(menu, /^Spanish.*In review/)).not.toBeNull();
  });

  it("says a stage named as the status is, beside it", async () => {
    standsIn({ es: "Live" });
    const menu = await open({
      document: {
        ...document,
        _translations: { es: { translated: true, status: "published" } },
      },
    });
    expect(item(menu, /^Spanish.*Live.*Live/)).not.toBeNull();
  });

  it("is drawn on a site with languages, and on no other", () => {
    const { unmount } = draw();
    expect(
      screen.getByRole("button", { name: "Languages, 1 needs attention" })
    ).toBeInTheDocument();
    unmount();

    site.languages = 1;
    draw();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leads to this document in each language", async () => {
    const menu = await open({ locale: "es" });
    expect(item(menu, /^Spanish/)).toHaveAttribute(
      "href",
      `${EDITOR}?locale=es&translate=en`
    );
    expect(item(menu, /^English/)).toHaveAttribute(
      "href",
      `${EDITOR}?locale=en`
    );
  });

  it("still leads there for someone who may not read every language's state", async () => {
    const menu = await open({
      document: { id: "p1", status: "published" },
    });
    expect(item(menu, /^Spanish/)).toHaveAttribute(
      "href",
      `${EDITOR}?locale=es&translate=en`
    );
  });

  it("says the document's own status only where it has that lifecycle", async () => {
    const draft = { ...document, status: "draft" };
    const menu = await open({ document: draft });
    expect(item(menu, /^English.*draft/)).not.toBeNull();
  });

  it("reads no status where there is no lifecycle", async () => {
    const draft = { ...document, status: "draft" };
    const menu = await open({ document: draft, hasStatus: false });
    expect(item(menu, /^English.*live/)).not.toBeNull();
  });

  it("offers publishing and managing to a person who may", async () => {
    permissions.held = ["read-settings"];
    const onPublishOthers = vi.fn();
    const menu = await open({ onPublishOthers });
    expect(item(menu, MANAGE)).not.toBeNull();
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: PUBLISH })
    );
    expect(onPublishOthers).toHaveBeenCalledTimes(1);
  });

  it("offers neither to a person who may not", async () => {
    const menu = await open();
    expect(item(menu, MANAGE)).toBeNull();
    expect(item(menu, PUBLISH)).toBeNull();
  });

  it("leads nowhere and publishes nothing while a past version is on screen", async () => {
    const menu = await open({
      hold: { ...NOTHING_HELD, viewingPastVersion: true },
      onPublishOthers: vi.fn(),
    });
    expect(within(menu).getByText(/past version/)).toBeInTheDocument();
    expect(item(menu, /^Spanish/)).not.toHaveAttribute("href");
    expect(item(menu, PUBLISH)).toBeNull();
  });

  it.each([
    { where: "a wide bar", width: 1200, panelMode: "docked", word: true },
    { where: "a narrow bar", width: 320, panelMode: "docked", word: false },
    { where: "a phone", width: 1200, panelMode: "sheet", word: false },
  ] as const)(
    "shows its word or speaks it, in $where",
    ({ width, panelMode, word }) => {
      bar.width = width;
      draw({ panelMode });
      const label = within(screen.getByRole("button")).getByText("Languages");
      expect(label.classList.contains("sr-only")).toBe(!word);
    }
  );
});
