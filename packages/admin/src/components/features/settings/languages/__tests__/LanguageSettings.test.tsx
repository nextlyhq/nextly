/**
 * Settings › Languages rendered against the server's answers, with the
 * languages service watched for what each control sends.
 *
 * - The list: each language's code, direction, fallback and content count, the
 *   count read as what making the current default the default would touch.
 * - Declared in the configuration: every language shown, read-only, saying
 *   where it is set, with no control and no count asked of the server (which
 *   refuses it for a locked list).
 * - Add says that no content changes and nothing is migrated; remove is
 *   confirmed, saying what readers and editors lose and that the content is
 *   kept; make default shows the server's summary first and is refused while
 *   the current default has unpublished changes.
 *
 * The plausible broken screen: controls drawn over a locked list, a remove
 * sent from the menu with no confirm, a remove dialog that does not say the
 * content is kept, a make-default confirm offered while the default has
 * pending changes, a non-destructive confirm styled as a delete, and a move
 * that sends a partial order.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { LanguagesContent } from "@admin/pages/dashboard/settings/languages/index";
import type {
  DefaultChangeSummary,
  LanguageList,
  LanguageView,
} from "@admin/types/languages";

const api = vi.hoisted(() => ({
  listLanguages: vi.fn(),
  previewDefaultChange: vi.fn(),
  changeLanguages: vi.fn(),
}));
const held = vi.hoisted(() => ({ permissions: new Set<string>() }));

vi.mock("@admin/services/languagesApi", () => api);
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({ data: { isAuthenticated: true } }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => held.permissions.has(slug),
  }),
}));

const ADMIN = ["read-settings", "update-settings"];
const READER = ["read-settings"];

function language(
  code: string,
  label: string,
  position: number,
  more: Partial<LanguageView> = {}
): LanguageView {
  return {
    code,
    label,
    direction: "ltr",
    fallback: [],
    position,
    isDefault: false,
    active: true,
    ...more,
  };
}

const ENGLISH = language("en", "English", 0, { isDefault: true });
const SPANISH = language("es", "Spanish", 1, { fallback: ["en"] });
const ARABIC = language("ar", "Arabic", 2, {
  direction: "rtl",
  fallback: ["en"],
});
const THREE: LanguageList = {
  lockedByConfig: false,
  languages: [ENGLISH, SPANISH, ARABIC],
};

function summary(
  from: string,
  to: string,
  pendingInCurrentDefault = 0
): DefaultChangeSummary {
  return {
    from,
    to,
    translationsPerLanguage: { en: 40, es: 12, ar: 1 },
    pendingInCurrentDefault,
  };
}

/** An error as `fetcher` raises it from the canonical envelope. */
function validationError(code: string, message: string): Error {
  return Object.assign(new Error("Validation failed."), {
    status: 400,
    code: "VALIDATION_ERROR",
    data: { errors: [{ path: "code", code, message }] },
  });
}

async function open(
  list: LanguageList = THREE,
  permissions: readonly string[] = ADMIN,
  preview: (code: string) => DefaultChangeSummary = code => summary("en", code)
) {
  held.permissions = new Set(permissions);
  api.listLanguages.mockResolvedValue(list);
  api.previewDefaultChange.mockImplementation((code: string) =>
    Promise.resolve(preview(code))
  );
  api.changeLanguages.mockResolvedValue(list);
  render(<LanguagesContent />);
  await screen.findByRole("list", { name: "Languages in use" });
}

const row = (name: string) => {
  const list = screen.getByRole("list", { name: "Languages in use" });
  const item = within(list)
    .getAllByRole("listitem")
    .find(each => within(each).queryByText(name, { selector: "span" }));
  if (!item) throw new Error(`No row for ${name}`);
  return item;
};

async function choose(name: string, action: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: action }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings › Languages", () => {
  it("lists each language with its code, writing direction, fallback and how much content it has", async () => {
    await open();

    // The counts are what making the current default the default touches.
    await waitFor(() =>
      expect(within(row("Spanish")).getByText("12 items")).toBeInTheDocument()
    );
    expect(api.previewDefaultChange).toHaveBeenCalledWith("en");

    const english = within(row("English"));
    expect(english.getByText("en")).toBeInTheDocument();
    expect(english.getByText("Default")).toBeInTheDocument();
    expect(english.getByText("Left to right")).toBeInTheDocument();
    expect(english.getByText("None")).toBeInTheDocument();
    expect(english.getByText("40 items")).toBeInTheDocument();

    const arabic = within(row("Arabic"));
    expect(arabic.getByText("ar")).toBeInTheDocument();
    expect(arabic.getByText("Right to left")).toBeInTheDocument();
    expect(arabic.getByText("English")).toBeInTheDocument();
    expect(arabic.getByText("1 item")).toBeInTheDocument();
    expect(within(row("Spanish")).queryByText("Default")).toBeNull();
  });

  it("shows the languages the configuration declares, read-only, in their order", async () => {
    await open({ ...THREE, lockedByConfig: true });

    const items = within(
      screen.getByRole("list", { name: "Languages in use" })
    ).getAllByRole("listitem");
    expect(
      items.map(item => within(item).getByText(/^[a-z]{2}$/).textContent)
    ).toEqual(["en", "es", "ar"]);
    expect(within(row("English")).getByText("Default")).toBeInTheDocument();
    expect(
      within(row("Arabic")).getByText("Right to left")
    ).toBeInTheDocument();
    expect(within(row("Spanish")).getByText("English")).toBeInTheDocument();
    // Nothing is offered to change them.
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("says where a locked list is set, and offers no add, edit, reorder or remove", async () => {
    await open({
      lockedByConfig: true,
      languages: [ENGLISH, SPANISH],
    });

    expect(
      screen.getByText(/set in this site's configuration/)
    ).toHaveTextContent(
      "These languages are set in this site's configuration, in the localization block of nextly.config.ts, so they can only be changed there."
    );
    expect(screen.queryByRole("button", { name: "Add language" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for / })).toBeNull();
    // The server refuses the count for a locked list, so it is not asked.
    expect(api.previewDefaultChange).not.toHaveBeenCalled();
  });

  it("offers no control to a reader who may not update settings", async () => {
    await open(THREE, READER);

    expect(screen.queryByRole("button", { name: "Add language" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for / })).toBeNull();
    expect(screen.queryByText(/set in this site's configuration/)).toBeNull();
  });

  it("says before adding that no content changes and nothing is migrated, and sends the new language", async () => {
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add language" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Add a language",
    });
    expect(dialog).toHaveAccessibleDescription(
      /changes no content and nothing is migrated/
    );
    await user.type(within(dialog).getByLabelText("Code"), "fr");
    await user.type(within(dialog).getByLabelText("Name"), "French");
    await user.click(
      within(dialog).getByRole("button", { name: "Add language" })
    );

    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith({
        kind: "add",
        code: "fr",
        label: "French",
        direction: "ltr",
        fallback: [],
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("confirms a remove, saying what readers and editors lose and that the content is kept", async () => {
    await open();
    await waitFor(() =>
      expect(within(row("Spanish")).getByText("12 items")).toBeInTheDocument()
    );
    const user = await choose("Spanish", "Remove…");

    const dialog = await screen.findByRole("alertdialog", {
      name: "Remove Spanish?",
    });
    expect(dialog).toHaveTextContent(
      "Readers can no longer read the site in Spanish, and languages that fall back to Spanish skip it."
    );
    expect(dialog).toHaveTextContent(
      "Editors can no longer write or translate content in Spanish."
    );
    expect(dialog).toHaveTextContent(
      "The content is kept. Nothing written in Spanish is deleted (12 items): adding Spanish again brings it back."
    );
    // Nothing is removed until it is confirmed.
    expect(api.changeLanguages).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.changeLanguages).not.toHaveBeenCalled();

    await choose("Spanish", "Remove…");
    const again = await screen.findByRole("alertdialog");
    const confirm = within(again).getByRole("button", {
      name: "Remove Spanish",
    });
    // A remove is the one destructive confirm on the page.
    expect(confirm.className).toContain("bg-destructive-solid");
    await user.click(confirm);
    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith({
        kind: "remove",
        code: "es",
      })
    );
  });

  it("offers no remove or make default for the default language", async () => {
    await open();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Actions for English" })
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent)
    ).toEqual(["Edit…", "Move down"]);
  });

  it("shows what making Spanish the default does, from the server's summary, before applying it", async () => {
    await open();
    const user = await choose("Spanish", "Make default…");

    const dialog = await screen.findByRole("alertdialog", {
      name: "Make Spanish the default?",
    });
    await within(dialog).findByText("Content in each language");
    expect(api.previewDefaultChange).toHaveBeenCalledWith("es");
    expect(dialog).toHaveTextContent(
      "Spanish becomes the language content is edited in, and the one readers get when they ask for no language. English stays a language of the site."
    );
    expect(dialog).toHaveTextContent(
      "Translation tracking restarts. Translations made from English lose the record of the English text they came from. Until each is next edited, it counts as out of date only when its source was saved after it."
    );
    expect(dialog).toHaveTextContent("English: 40 items");
    expect(dialog).toHaveTextContent("Spanish: 12 items");
    expect(dialog).toHaveTextContent("Arabic: 1 item");
    expect(api.changeLanguages).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole("button", {
      name: "Make Spanish the default",
    });
    // Not a delete: the primary style.
    expect(confirm.className).toContain("bg-primary");
    expect(confirm.className).not.toContain("bg-destructive");
    await user.click(confirm);
    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith({
        kind: "setDefault",
        code: "es",
        confirmed: true,
      })
    );
  });

  it("refuses to make another language the default while the current default has unpublished changes", async () => {
    await open(THREE, ADMIN, code =>
      code === "en" ? summary("en", "en", 2) : summary("en", code, 2)
    );
    await choose("Spanish", "Make default…");

    const dialog = await screen.findByRole("alertdialog", {
      name: "Make Spanish the default?",
    });
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(
      "English has 2 unpublished changes. Publish or discard them before making another language the default."
    );
    expect(
      within(dialog).getByRole("button", { name: "Make Spanish the default" })
    ).toBeDisabled();
    expect(api.changeLanguages).not.toHaveBeenCalled();
  });

  it("says the server's refusal when changes arrive in the default after the summary was read", async () => {
    await open();
    api.changeLanguages.mockRejectedValueOnce(
      validationError(
        "default_has_pending_changes",
        '"en" has 1 pending change(s). Publish or discard them before making another language the default.'
      )
    );
    const user = await choose("Spanish", "Make default…");
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText("Content in each language");
    await user.click(
      within(dialog).getByRole("button", { name: "Make Spanish the default" })
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      '"en" has 1 pending change(s). Publish or discard them before making another language the default.'
    );
    // Kept open, where the change was asked.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("moves a language by sending every language in the new order", async () => {
    await open();
    await choose("English", "Move down");

    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith({
        kind: "reorder",
        codes: ["es", "en", "ar"],
      })
    );
  });

  it("renames a language, sending only what changed", async () => {
    await open();
    const user = await choose("Spanish", "Edit…");
    const dialog = await screen.findByRole("dialog", { name: "Edit Spanish" });
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Español");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith({
        kind: "update",
        code: "es",
        label: "Español",
      })
    );
  });

  it("reads correctly on a site with one language: the page is where a second is added", async () => {
    await open({ lockedByConfig: false, languages: [ENGLISH] });

    expect(
      within(
        screen.getByRole("list", { name: "Languages in use" })
      ).getAllByRole("listitem")
    ).toHaveLength(1);
    expect(
      screen.getByText(
        "This site has one language. Add another to translate content into it."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add language" })
    ).toBeInTheDocument();
  });

  it("lists a removed language apart and adds it back with its content", async () => {
    await open({
      lockedByConfig: false,
      languages: [ENGLISH, language("fr", "French", 1, { active: false })],
    });

    const removed = screen.getByRole("list", { name: "Removed languages" });
    expect(within(removed).getByText("French")).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(removed).getByRole("button", { name: "Add French back" }));
    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith({
        kind: "add",
        code: "fr",
        label: "French",
        direction: "ltr",
      })
    );
  });
});
