/**
 * The Languages button as an editor mounts it: drawn for a translated document on a site with
 * languages and for no other, leading to this document's own addresses, and offering only what
 * the person may do at this moment.
 *
 * Catches a button on a document that has no languages, a person left with no way to another
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

const { site, permissions, bar } = vi.hoisted(() => ({
  site: { enabled: true },
  permissions: { held: [] as string[] },
  bar: { width: 1200 },
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: site.enabled,
    locales: [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "es", label: "Spanish", rtl: false, fallbackLocale: [] },
    ],
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

const NOTHING_HELD = {
  viewingPastVersion: false,
  recovering: false,
  changeAwaiting: false,
  documentHeld: false,
};

function draw(props: Partial<DocumentLanguagesButtonProps> = {}) {
  return render(
    <DocumentLanguagesButton
      documentLocalized
      document={document}
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
  site.enabled = true;
  permissions.held = [];
  bar.width = 1200;
});

describe("the document's Languages button", () => {
  it("is drawn for a translated document on a site with languages, and for no other", () => {
    const { unmount } = draw();
    expect(
      screen.getByRole("button", { name: "Languages, 1 needs attention" })
    ).toBeInTheDocument();
    unmount();

    draw({ documentLocalized: false });
    expect(screen.queryByRole("button")).toBeNull();

    site.enabled = false;
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
