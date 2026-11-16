/**
 * Templates in the new-entity dialog: a few quick ones for the kind, and
 * "Browse all templates", a searchable gallery with categories where each
 * template shows its source and the fields it adds. A picked template is
 * checked field by field; each failure is named with a way to leave the field
 * out, Create waits until none fails, and Create hands over the fields kept.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { render } from "@admin/__tests__/utils";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";

/** The field types installed plugins offer for entries. */
let pluginEntries: Array<{ type: string; label: string; hint: string }> = [];
vi.mock("@admin/components/field-ui", () => ({
  usePluginFieldTypeEntries: () => pluginEntries,
}));
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: async (kind: string, address: string) => ({
      kind,
      address,
      refusal: null,
    }),
  },
}));

import {
  registerSchemaTemplates,
  type SchemaTemplate,
} from "@admin/lib/builder/schema-templates";
import type { FieldDefinition } from "@admin/types/collection";

import { NewEntityDialog } from "../NewEntityDialog";

// Radix opens a dialog's content in a portal and scrolls; jsdom has neither.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

const acmeArticles: SchemaTemplate = {
  id: "articles",
  kind: "collection",
  category: "Acme",
  name: "Acme articles",
  description: "Articles in the Acme style.",
  fields: [{ name: "lede", label: "Lede", type: "text" }],
};

/** A plugin's template whose fields break one rule each, and one clean. */
const acmeFlawed: SchemaTemplate = {
  id: "flawed",
  kind: "collection",
  category: "Acme",
  name: "Acme flawed",
  description: "Breaks the rules.",
  fields: [
    { name: "summary", label: "Summary", type: "text" },
    { name: "Summary", label: "Summary again", type: "text" },
    { name: "created_at", label: "Created", type: "date" },
    { name: "Has Space", label: "Spaced", type: "text" },
    { name: "rating", label: "Rating", type: "acme-rating" },
  ],
};

/** A pages template whose own field takes the Page Builder field's name. */
const acmeLanding: SchemaTemplate = {
  id: "landing",
  kind: "collection",
  makes: "pages",
  category: "Acme",
  name: "Acme landing",
  description: "A landing page.",
  fields: [
    { name: "blocks", label: "Own blocks", type: "text" },
    { name: "hero", label: "Hero", type: "text" },
  ],
};

/** A template with a group whose own field breaks a rule. */
const acmeGrouped: SchemaTemplate = {
  id: "grouped",
  kind: "collection",
  category: "Acme",
  name: "Acme grouped",
  description: "A group with a bad field.",
  fields: [
    { name: "intro", label: "Intro", type: "text" },
    {
      name: "meta",
      label: "Meta",
      type: "group",
      fields: [{ name: "Bad Name", label: "Bad", type: "text" }],
    },
  ],
};

let removeAcme: () => void = () => {};

beforeEach(() => {
  pluginEntries = [];
  removeAcme = registerSchemaTemplates("Acme", [
    acmeArticles,
    acmeFlawed,
    acmeLanding,
    acmeGrouped,
  ]);
});

afterEach(() => {
  removeAcme();
});

function renderDialog() {
  const onCreate =
    vi.fn<(values: unknown, fields: FieldDefinition[]) => void>();
  render(
    <NewEntityDialog
      open
      config={COLLECTION_BUILDER_CONFIG}
      onCancel={vi.fn()}
      onCreate={onCreate}
    />
  );
  return { onCreate, user: userEvent.setup() };
}

const createButton = () => screen.getByRole("button", { name: "Create" });

/** The gallery's template cards, by their headings. */
function cardNames(gallery: HTMLElement): string[] {
  return within(gallery)
    .getAllByRole("heading", { level: 3 })
    .map(heading => heading.textContent ?? "");
}

describe("templates in the new-entity dialog", () => {
  it("search and categories, with a test plugin's template", async () => {
    const { user } = renderDialog();
    await user.click(
      screen.getByRole("button", { name: "Browse all templates" })
    );
    const gallery = await screen.findByRole("dialog", {
      name: "All templates",
    });
    expect(cardNames(gallery)).toEqual(
      expect.arrayContaining(["Blog posts", "Products", "Acme articles"])
    );
    // Only this kind's: a Single's template is not offered for a collection.
    expect(cardNames(gallery)).not.toContain("Site settings");

    // Each shows where it comes from and the fields it adds.
    const acme = within(gallery)
      .getByRole("heading", { name: "Acme articles" })
      .closest("article") as HTMLElement;
    expect(within(acme).getByText("From Acme")).toBeInTheDocument();
    expect(within(acme).getByText(/Lede/)).toBeInTheDocument();
    const blog = within(gallery)
      .getByRole("heading", { name: "Blog posts" })
      .closest("article") as HTMLElement;
    expect(within(blog).getByText("Built in")).toBeInTheDocument();

    await user.type(
      within(gallery).getByRole("searchbox", { name: "Search templates" }),
      "acme art"
    );
    expect(cardNames(gallery)).toEqual(["Acme articles"]);

    await user.clear(
      within(gallery).getByRole("searchbox", { name: "Search templates" })
    );
    await user.click(within(gallery).getByRole("button", { name: "Commerce" }));
    expect(cardNames(gallery)).toEqual(["Products"]);
  });

  it("a test plugin's template with two names differing in case, a reserved name, an invalid name and a type the Builder does not offer: each named, Create available once each is left out", async () => {
    const { onCreate, user } = renderDialog();
    await user.click(
      screen.getByRole("button", { name: "Browse all templates" })
    );
    const gallery = await screen.findByRole("dialog", {
      name: "All templates",
    });
    await user.click(
      within(gallery).getByRole("button", { name: "Use Acme flawed" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "All templates" })).toBeNull()
    );

    await user.type(screen.getByLabelText("Name"), "Thing");
    const picked = screen.getByRole("group", { name: "Template: Acme flawed" });
    // Each failing field is named, with what it breaks.
    expect(
      within(picked).getAllByText(/same name in other letter case/)
    ).toHaveLength(2);
    expect(
      within(picked).getByText(/"created_at" is reserved here/)
    ).toBeInTheDocument();
    expect(
      within(picked).getByText(/"Has Space" is not a name/)
    ).toBeInTheDocument();
    expect(
      within(picked).getByText(/from a plugin that is not installed/)
    ).toBeInTheDocument();
    // Held by the template, once the address check has settled: the reason
    // Create gives is the template's, not that the address is being checked.
    expect(
      await screen.findByText(
        "Leave out the fields this template cannot add, or choose another template."
      )
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();

    for (const label of ["Summary again", "Created", "Spaced", "Rating"]) {
      await user.click(
        within(picked).getByRole("checkbox", { name: `Leave out ${label}` })
      );
    }
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    const fields = onCreate.mock.calls.at(-1)?.[1] ?? [];
    expect(fields.map(field => field.name)).toEqual(["summary"]);
  });

  it("applies a quick template's fields on Create", async () => {
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Authors/ }));
    await user.type(screen.getByLabelText("Name"), "Writer");
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    const fields = onCreate.mock.calls.at(-1)?.[1] ?? [];
    expect(fields.map(field => field.name)).toEqual(["photo", "bio", "email"]);
  });

  it("creates with no template's fields when none is picked", async () => {
    const { onCreate, user } = renderDialog();
    expect(screen.getByRole("radio", { name: /No template/ })).toBeChecked();
    await user.type(screen.getByLabelText("Name"), "Thing");
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(onCreate.mock.calls.at(-1)?.[1]).toEqual([]);
  });

  it("keeps entries templates for a starting field that is not the Page Builder's", async () => {
    pluginEntries = [{ type: "acme-rating", label: "Rating", hint: "Stars." }];
    const { user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Rating/ }));
    // Still entries: the quick templates are the entries ones.
    expect(screen.getByRole("radio", { name: /Authors/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Acme landing/ })).toBeNull();
  });

  it("names a template field that takes the starting field's name, and lets it be left out", async () => {
    pluginEntries = [
      {
        type: "blocks",
        label: "Blocks",
        hint: "Lay the page out from blocks.",
      },
    ];
    const { onCreate, user } = renderDialog();
    await user.click(
      screen.getByRole("radio", { name: /Pages you design visually/ })
    );
    await user.click(screen.getByRole("radio", { name: /Acme landing/ }));
    await user.type(screen.getByLabelText("Name"), "Landing");
    const picked = screen.getByRole("group", {
      name: "Template: Acme landing",
    });
    expect(
      within(picked).getByText(/as the starting field blocks beside it/)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Leave out the fields this template cannot add, or choose another template."
      )
    ).toBeInTheDocument();
    await user.click(
      within(picked).getByRole("checkbox", { name: "Leave out Own blocks" })
    );
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    const fields = onCreate.mock.calls.at(-1)?.[1] ?? [];
    expect(fields.map(field => field.name)).toEqual(["hero"]);
  });

  it("shows the fields inside a container left out as left out with it", async () => {
    const { user } = renderDialog();
    await user.click(
      screen.getByRole("button", { name: "Browse all templates" })
    );
    const gallery = await screen.findByRole("dialog", {
      name: "All templates",
    });
    await user.click(
      within(gallery).getByRole("button", { name: "Use Acme grouped" })
    );
    const picked = await screen.findByRole("group", {
      name: "Template: Acme grouped",
    });
    await user.click(
      within(picked).getByRole("checkbox", { name: "Leave out Meta" })
    );
    // Bad goes with Meta: said so, and not offered back on its own.
    expect(within(picked).getByText("Left out with Meta")).toBeInTheDocument();
    expect(
      within(picked).queryByRole("checkbox", { name: "Leave out Bad" })
    ).toBeNull();
  });

  it("lets any field be left out, a valid one too", async () => {
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Authors/ }));
    const picked = screen.getByRole("group", { name: "Template: Authors" });
    await user.click(
      within(picked).getByRole("checkbox", { name: "Leave out Bio" })
    );
    await user.type(screen.getByLabelText("Name"), "Writer");
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    const fields = onCreate.mock.calls.at(-1)?.[1] ?? [];
    expect(fields.map(field => field.name)).toEqual(["photo", "email"]);
  });
});
