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
import { QueryClient } from "@tanstack/react-query";
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
  // Kept while nothing reads it, unlike the shared test client's, so a test
  // can look at a query no screen holds.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<LanguagesContent />, { queryClient });
  await screen.findByRole("list", { name: "Languages in use" });
  return queryClient;
}

/** A promise settled from outside, for a read held in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
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

  it("names a fallback with its code where two languages share its name", async () => {
    await open({
      lockedByConfig: true,
      languages: [
        language("en-GB", "English", 0, { isDefault: true }),
        language("en-US", "English", 1, { fallback: ["en-GB"] }),
        language("es", "Spanish", 2, { fallback: ["en-US", "en-GB"] }),
        language("fr", "French", 3, { fallback: ["es"] }),
      ],
    });

    expect(
      within(row("Spanish")).getByText("English (en-US), then English (en-GB)")
    ).toBeInTheDocument();
    // A name no other language shares stays as it is.
    expect(within(row("French")).getByText("Spanish")).toBeInTheDocument();
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

  it("names each fallback choice with its code, so two languages sharing a name can be told apart", async () => {
    await open({
      lockedByConfig: false,
      languages: [
        language("en-GB", "English", 0, { isDefault: true }),
        language("en-US", "English", 1),
      ],
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add language" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add a language",
    });
    await user.click(
      within(dialog).getByRole("combobox", { name: "Falls back to" })
    );

    const options = await screen.findAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      "None",
      "English (en-GB)",
      "English (en-US)",
    ]);
    await user.click(screen.getByRole("option", { name: "English (en-US)" }));
    await user.type(within(dialog).getByLabelText("Code"), "en-AU");
    await user.type(
      within(dialog).getByLabelText("Name"),
      "Australian English"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add language" })
    );
    await waitFor(() =>
      expect(api.changeLanguages).toHaveBeenCalledWith(
        expect.objectContaining({ code: "en-AU", fallback: ["en-US"] })
      )
    );
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
      "Translations keep their records. Each translated value still records the language it was made from, Spanish's translations from English included, and counts as out of date when that language's text changes. What is written in Spanish from now on counts as written originally in Spanish."
    );
    // The change rewrites no record, so the dialog claims none is lost.
    expect(dialog).not.toHaveTextContent(/lose|restart/i);
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

  it("offers make default only from a summary read now, not one being read again or one whose read failed", async () => {
    const queryClient = await open();
    const user = await choose("Spanish", "Make default…");
    const dialog = await screen.findByRole("alertdialog", {
      name: "Make Spanish the default?",
    });
    await within(dialog).findByText("Content in each language");
    const confirm = within(dialog).getByRole("button", {
      name: "Make Spanish the default",
    });
    expect(confirm).toBeEnabled();

    // Read again: the earlier summary is still shown, but not confirmable.
    const again = deferred<DefaultChangeSummary>();
    api.previewDefaultChange.mockReturnValueOnce(again.promise);
    void queryClient.invalidateQueries({
      queryKey: ["languages", "default-preview", "es"],
    });
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(dialog).toHaveTextContent("Content in each language");

    // That read fails: the dialog says so, and still offers no confirm.
    again.reject(new Error("The server is unavailable."));
    expect(
      await within(dialog).findByRole("button", { name: "Retry" })
    ).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    // Read again successfully: confirmable once more.
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(confirm).toBeEnabled());
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

  it("marks the entries and Single documents read so far stale once a change is saved", async () => {
    const queryClient = await open();
    // Reads as the editor and the lists keep them: an entry, a list, a Single.
    const entry = ["entries", "detail", "posts", "p1"];
    const entries = ["entries", "list", "posts"];
    const single = ["single-documents", "detail", "homepage"];
    // And one no language change touches, as the control.
    const unrelated = ["dashboard", "stats"];
    for (const key of [entry, entries, single, unrelated]) {
      queryClient.setQueryData(key, { stored: true });
    }

    await choose("English", "Move down");
    await waitFor(() => expect(api.changeLanguages).toHaveBeenCalled());

    await waitFor(() =>
      expect(queryClient.getQueryState(entry)?.isInvalidated).toBe(true)
    );
    expect(queryClient.getQueryState(entries)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(single)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("keeps the saved list when a read of the list begun before the change lands after it", async () => {
    const queryClient = await open();
    // A read of the list in flight, answering the list as it was.
    const stale = deferred<LanguageList>();
    api.listLanguages.mockReturnValueOnce(stale.promise);
    void queryClient.invalidateQueries({ queryKey: ["languages", "list"] });
    await waitFor(() => expect(api.listLanguages).toHaveBeenCalledTimes(2));

    // The move is saved, and the server answers the new order.
    api.changeLanguages.mockResolvedValueOnce({
      lockedByConfig: false,
      languages: [
        { ...ENGLISH, position: 1 },
        { ...SPANISH, position: 0 },
        ARABIC,
      ],
    });
    await choose("English", "Move down");
    await waitFor(() => expect(api.changeLanguages).toHaveBeenCalled());
    const names = () =>
      within(screen.getByRole("list", { name: "Languages in use" }))
        .getAllByRole("listitem")
        .map(item => item.querySelector("span")?.textContent);
    await waitFor(() =>
      expect(names()).toEqual(["Spanish", "English", "Arabic"])
    );

    // The earlier read lands now; the saved order stays.
    stale.resolve(THREE);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(names()).toEqual(["Spanish", "English", "Arabic"]);
  });

  it("offers no change while one is being saved, and keeps it saving when a dialog opens after", async () => {
    await open();
    const saving = deferred<LanguageList>();
    api.changeLanguages.mockReturnValueOnce(saving.promise);
    await choose("English", "Move down");
    await waitFor(() => expect(api.changeLanguages).toHaveBeenCalledTimes(1));

    // While the move is saved, nothing that starts a change is offered.
    expect(screen.getByRole("button", { name: "Add language" })).toBeDisabled();
    for (const name of ["English", "Spanish", "Arabic"]) {
      expect(
        screen.getByRole("button", { name: `Actions for ${name}` })
      ).toBeDisabled();
    }
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Actions for Spanish" })
    );
    expect(screen.queryByRole("menu")).toBeNull();

    // Saved: offered again. A dialog opened and closed sends nothing more.
    saving.resolve(THREE);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add language" })).toBeEnabled()
    );
    await choose("Spanish", "Edit…");
    await screen.findByRole("dialog", { name: "Edit Spanish" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.changeLanguages).toHaveBeenCalledTimes(1);
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

  it("gives focus back to the control that opened a dialog when it closes", async () => {
    await open();
    const user = userEvent.setup();

    const add = screen.getByRole("button", { name: "Add language" });
    await user.click(add);
    await screen.findByRole("dialog", { name: "Add a language" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(add).toHaveFocus());

    // From a row's menu, focus goes back to that row's menu button.
    await choose("Spanish", "Make default…");
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Actions for Spanish" })
      ).toHaveFocus()
    );
  });

  it("gives focus to Add language once a removal is saved, the removed row's menu button being gone", async () => {
    await open();
    api.changeLanguages.mockResolvedValueOnce({
      lockedByConfig: false,
      languages: [ENGLISH, { ...SPANISH, active: false }, ARABIC],
    });
    const user = await choose("Spanish", "Remove…");
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove Spanish" })
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // The row moved to the removed list, and its menu button with it.
    expect(
      screen.queryByRole("button", { name: "Actions for Spanish" })
    ).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add language" })).toHaveFocus()
    );
  });

  it("counts a language the server lists no translations for as holding none", async () => {
    // The server's summary names only the languages that hold translation
    // rows; on a site with no translated content it names none at all.
    await open(THREE, ADMIN, code => ({
      ...summary("en", code),
      translationsPerLanguage: { en: 3 },
    }));

    await waitFor(() =>
      expect(within(row("English")).getByText("3 items")).toBeInTheDocument()
    );
    expect(within(row("Spanish")).getByText("0 items")).toBeInTheDocument();
    expect(within(row("Arabic")).getByText("0 items")).toBeInTheDocument();
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

  it("lists a removed language apart and adds it back with its content and its fallback", async () => {
    // French fell back to Spanish, then German; German has been removed since,
    // and the server refuses a fallback naming a language not in use.
    const german = language("de", "German", 3, { active: false });
    await open({
      lockedByConfig: false,
      languages: [
        ENGLISH,
        SPANISH,
        language("fr", "French", 2, {
          active: false,
          direction: "ltr",
          fallback: ["es", "de"],
        }),
        german,
      ],
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
        fallback: ["es"],
      })
    );
  });
});
