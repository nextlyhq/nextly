/**
 * The text inside a repeater, a group and a component on the page: each text
 * beside its own row's source, whatever the order there, and a save that sends
 * the container with that text changed and nothing around it. Only the requests
 * and the reader's rights are replaced.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type { PublishPartsChoice } from "@admin/services/publishParts";

import { TranslationPage } from "../TranslationPage";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  update: vi.fn(),
  publishParts: vi.fn(),
}));
const reader = vi.hoisted(() => ({ update: "allowed" as string }));
const schema = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: { ...actual.entryApi, ...api },
  };
});
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useCollections")
  >()),
  useCollectionSchema: () => ({
    data: schema.value,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => reader.update,
}));
vi.mock("@admin/hooks/queries/useDocumentLockHolder", () => ({
  useDocumentLockHolder: () => null,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    plugins: [],
    locales: {
      defaultLocale: "en",
      fallback: true,
      locales: [
        { code: "en", label: "English", rtl: false, fallbackLocale: [] },
        { code: "es", label: "Spanish", rtl: false, fallbackLocale: ["en"] },
      ],
    },
  }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
    retry: vi.fn(),
  }),
}));

const COLLECTION = {
  name: "notes",
  label: "Notes",
  localized: true,
  status: true,
  draftsEnabled: true,
  admin: { useAsTitle: "title" },
  fields: [
    {
      name: "slides",
      type: "repeater",
      label: "Slides",
      labels: { singular: "Slide", plural: "Slides" },
      fields: [
        { name: "caption", type: "text", label: "Caption" },
        { name: "position", type: "number", label: "Position" },
      ],
    },
    { name: "title", type: "text", label: "Title" },
    {
      name: "intro",
      type: "group",
      label: "Introduction",
      fields: [{ name: "lead", type: "textarea", label: "Lead" }],
    },
    {
      name: "seo",
      type: "fieldGroup",
      label: "Search",
      fieldGroup: "seo",
      componentFields: [{ name: "summary", type: "text", label: "Summary" }],
    },
    { name: "layout", type: "blocks", label: "Layout" },
  ],
};

const row = (id: string, caption: string | null, position: number) => ({
  id,
  caption,
  position,
});
const SPANISH_SLIDES = [row("a", "Uno", 1), row("b", null, 2)];
// The same rows; a read of every language keeps one order, but nothing here
// may lean on it.
const ENGLISH_SLIDES = [row("b", "Two", 2), row("a", "One", 1)];

const written = () => ({
  id: "n1",
  status: "published",
  title: "Nota",
  slides: SPANISH_SLIDES,
  intro: { lead: null },
  seo: [{ id: "s1", summary: "Resumen" }],
  _rev: "7.es:3",
  _translations: {
    en: { translated: true, status: "published" },
    es: {
      translated: true,
      status: "published",
      fields: { slides: { origin: "person", outOfDate: true } },
    },
  },
});
const live = () => ({
  ...written(),
  _translations: undefined,
  _allLocales: {
    title: { en: "Note", es: "Nota" },
    slides: { en: ENGLISH_SLIDES, es: SPANISH_SLIDES },
    intro: { en: { lead: "Lead in English" }, es: { lead: null } },
    seo: {
      en: [{ id: "s1", summary: "Summary in English" }],
      es: [{ id: "s1", summary: "Resumen" }],
    },
    layout: { en: { nodes: [] }, es: null },
  },
});

let stored: ReturnType<typeof written>;
let served: ReturnType<typeof live>;

const render = () =>
  renderWithProviders(
    <TranslationPage
      document={{ kind: "collection", slug: "notes", id: "n1" }}
    />
  );
const text = (name: string) => screen.findByRole("group", { name });
const control = async (name: string) =>
  within(await text(name)).getByRole("textbox");
const save = () => screen.getByRole("button", { name: /^Save( draft)?$/ });
const body = (call = 0) =>
  api.update.mock.calls[call]?.[2] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    "",
    "/admin/translations/collections/notes/n1?locale=es"
  );
  reader.update = "allowed";
  schema.value = COLLECTION;
  stored = written();
  served = live();
  api.findByID.mockImplementation(
    (_s: string, _i: string, read: { everyLanguage?: boolean }) =>
      Promise.resolve(read.everyLanguage ? served : stored)
  );
  api.update.mockImplementation(
    (_s: string, _i: string, payload: Record<string, unknown>) => {
      stored = { ...stored, ...payload, _rev: "7.es:4" } as typeof stored;
      return Promise.resolve({ item: stored });
    }
  );
});

describe("the text inside a container", () => {
  it("is drawn beside its own row's source, whatever the order there", async () => {
    render();
    const first = await text("Slide 1, Caption");
    expect(within(first).getByText("One")).toBeInTheDocument();
    expect(within(first).getByRole("textbox")).toHaveValue("Uno");
    const second = await text("Slide 2, Caption");
    expect(within(second).getByText("Two")).toBeInTheDocument();
    expect(within(second).getByRole("textbox")).toHaveValue("");
    // The rows stand under their own names, in the document's order.
    expect(screen.getByRole("group", { name: "Slide 1" })).toContainElement(
      first
    );
    expect(screen.getByRole("group", { name: "Slides" })).toContainElement(
      second
    );
  });

  it("offers no shared value and no change of structure", async () => {
    render();
    const slides = await screen.findByRole("group", { name: "Slides" });
    expect(within(slides).queryByText("Position")).not.toBeInTheDocument();
    expect(within(slides).queryByRole("button")).not.toBeInTheDocument();
  });

  it("is drawn of a group and of a component, in the form's order", async () => {
    render();
    await text("Introduction, Lead");
    expect(
      within(await text("Search, Summary")).getByText("Summary in English")
    ).toBeInTheDocument();
    expect(await control("Search, Summary")).toHaveValue("Resumen");
    const order = screen
      .getAllByRole("textbox")
      .map(box => box.closest('[role="group"]')?.getAttribute("aria-label"));
    expect(order).toEqual([
      "Slide 1, Caption",
      "Slide 2, Caption",
      "Title",
      "Introduction, Lead",
      "Search, Summary",
    ]);
  });

  it("says once, on the container, that its source changed since", async () => {
    render();
    const slides = await screen.findByRole("group", { name: "Slides" });
    expect(within(slides).getAllByText("out of date")).toHaveLength(1);
    expect(screen.getAllByText("out of date")).toHaveLength(1);
  });

  it("is written as original where its row has no source", async () => {
    served._allLocales.slides.en = [row("a", "One", 1)];
    render();
    expect(
      within(await text("Slide 2, Caption")).getByText(
        /written here as original Spanish/
      )
    ).toBeInTheDocument();
    expect(
      within(await text("Slide 1, Caption")).queryByText(/as original/)
    ).not.toBeInTheDocument();
  });

  it("cannot be written in by a reader who may only look", async () => {
    reader.update = "refused";
    render();
    expect(await control("Slide 1, Caption")).toHaveAttribute("readonly");
  });

  it("follows the container's own gates", async () => {
    schema.value = {
      ...COLLECTION,
      fields: COLLECTION.fields.map(field =>
        field.name === "intro"
          ? { ...field, admin: { readOnly: true } }
          : field.name === "slides"
            ? {
                ...field,
                admin: { condition: { field: "title", equals: "x" } },
              }
            : field
      ),
    };
    render();
    expect(await control("Introduction, Lead")).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("group", { name: "Slides" })
    ).not.toBeInTheDocument();
  });

  it("is drawn for nothing where a group holds nothing in any language", async () => {
    stored = { ...stored, intro: null as never };
    render();
    await text("Slide 1, Caption");
    expect(
      screen.queryByRole("group", { name: "Introduction" })
    ).not.toBeInTheDocument();
  });

  it("names the page-builder content, translated in its own editor", async () => {
    render();
    const elsewhere = await screen.findByRole("region", {
      name: "Not translated here",
    });
    expect(elsewhere).toHaveTextContent("Layout");
  });
});

describe("saving the text inside a container", () => {
  it("sends the container with that text changed, and nothing else", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await control("Slide 2, Caption"), "Dos");
    await user.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(body()).toEqual({
      slides: [SPANISH_SLIDES[0], row("b", "Dos", 2)],
      _rev: "7.es:3",
    });
  });

  it("sends a component as the one instance it is", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await control("Search, Summary"), "!");
    await user.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(body()).toEqual({
      seo: { id: "s1", summary: "Resumen!" },
      _rev: "7.es:3",
    });
  });

  it("sends nothing for a text typed and put back", async () => {
    const user = userEvent.setup();
    render();
    const caption = await control("Slide 1, Caption");
    await user.type(caption, "!");
    await user.type(caption, "{Backspace}");
    expect(save()).toBeDisabled();
  });

  it("claims a container as original where none of its text had a source", async () => {
    served._allLocales.intro.en = null as never;
    const user = userEvent.setup();
    render();
    await user.type(await control("Introduction, Lead"), "Hola");
    await user.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(body()).toEqual({
      intro: { lead: "Hola" },
      _provenance: { intro: { origin: "original" } },
      _rev: "7.es:3",
    });
  });

  it("saves the next change onto what the save before it sent", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await control("Slide 2, Caption"), "Dos");
    await user.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
    await user.type(await control("Slide 1, Caption"), "!");
    await user.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual({
      slides: [row("a", "Uno!", 1), row("b", "Dos", 2)],
      _rev: "7.es:4",
    });
  });

  it("puts a refusal of one text on that text", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            data: {
              errors: [
                {
                  path: "slides.1.caption",
                  code: "TOO_LONG",
                  message: "Too long for a caption.",
                },
              ],
            },
          },
        },
        400
      )
    );
    render();
    await user.type(await control("Slide 2, Caption"), "Dos");
    await user.click(save());
    expect(
      await within(await text("Slide 2, Caption")).findByText(
        "Too long for a caption."
      )
    ).toBeInTheDocument();
  });

  it("saved anyway, writes onto the rows there are now and puts none back", async () => {
    const user = userEvent.setup();
    api.update.mockRejectedValueOnce(
      parseApiError(
        {
          error: {
            code: "STALE_VERSION",
            message: "The document changed.",
            data: { currentVersion: "8.es:3" },
          },
        },
        409
      )
    );
    render();
    await user.type(await control("Slide 2, Caption"), "Dos");
    // Meanwhile: the first row is gone, and another was put before the second.
    stored = {
      ...stored,
      slides: [row("c", "Tres", 3), row("b", null, 2)],
      _rev: "8.es:3",
    };
    // From the save on, the document is not read again: what the form shows is
    // what the save left in it.
    api.update.mockImplementation(
      (_s: string, _i: string, payload: Record<string, unknown>) => {
        api.findByID.mockImplementation(() => new Promise(() => undefined));
        return Promise.resolve({
          item: { ...stored, ...payload, _rev: "9.es:4" },
        });
      }
    );
    await user.click(save());
    await user.click(
      await screen.findByRole("button", { name: "Save anyway" })
    );
    // Asked once more before anyone's changes are replaced.
    await user.click(
      await screen.findByRole("button", { name: "Replace their changes" })
    );
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(body(1)).toMatchObject({
      slides: [row("c", "Tres", 3), row("b", "Dos", 2)],
      _overwrite: true,
    });
    await waitFor(async () =>
      expect(await control("Slide 1, Caption")).toHaveValue("Tres")
    );
    expect(await control("Slide 2, Caption")).toHaveValue("Dos");
  });
});

it("names the texts left empty when the language is published", async () => {
  const user = userEvent.setup();
  stored._translations.es.status = "draft";
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      Promise.resolve({
        id: "n1",
        languages: (choice.locales as string[]).map(locale => ({
          locale,
          outcome: "goes-live",
        })),
        shared: { changes: false, added: false },
      })
  );
  render();
  await text("Slide 1, Caption");
  await user.click(screen.getByRole("button", { name: "Publish Spanish" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    (await within(dialog).findAllByRole("listitem")).map(
      item => item.textContent
    )
  ).toEqual([
    "Slide 2, Caption: English is shown",
    "Introduction, Lead: English is shown",
  ]);
});
