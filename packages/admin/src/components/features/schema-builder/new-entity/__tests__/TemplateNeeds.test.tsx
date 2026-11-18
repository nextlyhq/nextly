/**
 * What a picked template needs to exist: a collection its link points at, a
 * field group a field uses. Each target neither saved nor waiting unsaved is
 * named under the template, made too by default, and handed over with the
 * entity, owned by it, so the entity's save creates it first. A target the
 * server would refuse, or one not made too, holds Create until the field that
 * needs it is left out.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";

vi.mock("@admin/components/field-ui", () => ({
  usePluginFieldTypeEntries: () => [],
}));
/** What the server's address check refuses, by "kind:address". */
let refusals: Record<string, { code: string; message: string }> = {};
/** Each address check asked: its kind, address and the addresses counted as pending. */
const checks: Array<{
  kind: string;
  address: string;
  pending: ReadonlyArray<{ kind: string; address: string }>;
}> = [];
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: async (
      kind: string,
      address: string,
      pending: ReadonlyArray<{ kind: string; address: string }> = []
    ) => {
      checks.push({ kind, address, pending });
      return { kind, address, refusal: refusals[`${kind}:${address}`] ?? null };
    },
  },
}));

/** The entities the server holds, as "collection:x", "single:x" or "field-group:x". */
let existing = new Set<string>();
/** The entities whose read fails with a server error, by the same keys. */
let failing = new Set<string>();
/** A read of one entity by address, as the services answer it. */
function readOf(kind: string) {
  return async (address: string) => {
    const key = `${kind}:${address}`;
    if (failing.has(key)) {
      throw Object.assign(new Error("The server is unavailable."), {
        status: 500,
        code: "INTERNAL_ERROR",
      });
    }
    if (existing.has(key)) return { slug: address };
    throw Object.assign(new Error("Not found."), {
      status: 404,
      code: "NOT_FOUND",
    });
  };
}
vi.mock("@admin/services/collectionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/collectionApi")>();
  return {
    ...actual,
    collectionApi: { ...actual.collectionApi, get: readOf("collection") },
  };
});
vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: { ...actual.singleApi, get: readOf("single") },
  };
});
vi.mock("@admin/services/fieldGroupApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/fieldGroupApi")>();
  return {
    ...actual,
    fieldGroupApi: { ...actual.fieldGroupApi, get: readOf("field-group") },
  };
});

import { registerSchemaTemplates } from "@admin/lib/builder/schema-templates";

import type { UnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderSettingsValues } from "../../BuilderSettingsModal";
import { NewEntityDialog } from "../NewEntityDialog";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  refusals = {};
  checks.length = 0;
  existing = new Set();
  failing = new Set();
});

type Needed = Omit<UnsavedEntity, "token">;

function renderDialog() {
  const onCreate =
    vi.fn<
      (
        values: BuilderSettingsValues,
        fields: FieldDefinition[],
        needed: Needed[]
      ) => void
    >();
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
const picked = () =>
  screen.getByRole("group", { name: "Template: Blog posts" });

describe("what a template needs", () => {
  it("makes a missing collection too, by default, owned by the new entity", async () => {
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");

    const createToo = await within(picked()).findByRole("checkbox", {
      name: "Create the collection authors too",
    });
    expect(createToo).toBeChecked();
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());

    const [values, fields, needed] = onCreate.mock.calls.at(-1) ?? [];
    expect(fields?.map(field => field.name)).toContain("author");
    expect(needed).toEqual([
      {
        kind: "collection",
        address: "authors",
        settings: expect.objectContaining({
          singularName: "Authors",
          pluralName: "Authors",
          slug: "authors",
          // The collection kind's create defaults: drafts on.
          status: true,
        }),
        fields: [],
        ownedBy: { kind: "collection", address: values?.slug },
      },
    ]);
  });

  it("holds Create while a missing one is not made too, until the field needing it is left out", async () => {
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");
    await user.click(
      await within(picked()).findByRole("checkbox", {
        name: "Create the collection authors too",
      })
    );
    expect(
      await screen.findByText(
        "Create what the template needs too, or leave out the fields that need it."
      )
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();

    await user.click(
      within(picked()).getByRole("checkbox", { name: "Leave out Author" })
    );
    expect(
      within(picked()).queryByRole("checkbox", {
        name: "Create the collection authors too",
      })
    ).toBeNull();
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    const [, fields, needed] = onCreate.mock.calls.at(-1) ?? [];
    expect(fields?.map(field => field.name)).not.toContain("author");
    expect(needed).toEqual([]);
  });

  it("makes nothing for a collection that exists", async () => {
    existing = new Set(["collection:authors"]);
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");
    await waitFor(() => expect(createButton()).toBeEnabled());
    expect(
      within(picked()).queryByRole("checkbox", {
        name: "Create the collection authors too",
      })
    ).toBeNull();
    await user.click(createButton());
    expect(onCreate.mock.calls.at(-1)?.[2]).toEqual([]);
  });

  it("names one the server would refuse, and holds Create until the field needing it is left out", async () => {
    refusals = {
      "collection:authors": {
        code: "VALIDATION_ERROR",
        message: "This address is reserved.",
      },
    };
    const { user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");
    expect(
      await within(picked()).findByText(
        "The collection authors cannot be made: This address is reserved."
      )
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    await user.click(
      within(picked()).getByRole("checkbox", { name: "Leave out Author" })
    );
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it("needs nothing made for a link to the entity being created", async () => {
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Authors");
    await waitFor(() => expect(createButton()).toBeEnabled());
    expect(
      within(picked()).queryByRole("checkbox", {
        name: "Create the collection authors too",
      })
    ).toBeNull();
    await user.click(createButton());
    expect(onCreate.mock.calls.at(-1)?.[2]).toEqual([]);
  });

  it("takes a Single under the address, and Users, as the link editor offers them, whatever a new create could take", async () => {
    existing = new Set(["single:authors"]);
    // Neither is ever asked of the address rule, which keeps `users` for itself.
    refusals = {
      "collection:users": { code: "SLUG_RESERVED", message: "Reserved." },
    };
    const remove = registerSchemaTemplates("Acme", [
      {
        id: "with-users",
        kind: "collection",
        category: "Acme",
        name: "Acme reviews",
        description: "Reviews by users.",
        fields: [
          {
            name: "reviewer",
            label: "Reviewer",
            type: "relationship",
            relationTo: "users",
          },
        ],
      },
    ]);
    try {
      const { user } = renderDialog();
      await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
      await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");
      await waitFor(() => expect(createButton()).toBeEnabled());
      expect(
        within(picked()).queryByText(/Create the collection authors too/)
      ).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Browse all templates" })
      );
      const gallery = await screen.findByRole("dialog", {
        name: "All templates",
      });
      await user.click(
        within(gallery).getByRole("button", { name: "Use Acme reviews" })
      );
      await waitFor(() => expect(createButton()).toBeEnabled());
      expect(screen.queryByText(/collection users/)).toBeNull();
      expect(checks.some(each => each.address === "users")).toBe(false);
    } finally {
      remove();
    }
  });

  it("names a need it could not check, and holds Create until the field needing it is left out", async () => {
    failing = new Set(["collection:authors"]);
    const { user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");
    expect(
      await within(picked()).findByText(
        /The collection authors could not be checked: The server is unavailable/,
        {},
        { timeout: 10_000 }
      )
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    await user.click(
      within(picked()).getByRole("checkbox", { name: "Leave out Author" })
    );
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it("checks each needed address with the others it needs, and the new entity, as pending", async () => {
    const remove = registerSchemaTemplates("Acme", [
      {
        id: "two-needs",
        kind: "collection",
        category: "Acme",
        name: "Acme double",
        description: "Two links.",
        fields: [
          {
            name: "a",
            label: "A",
            type: "relationship",
            relationTo: "blog-posts",
          },
          {
            name: "b",
            label: "B",
            type: "relationship",
            relationTo: "blog_posts",
          },
        ],
      },
    ]);
    try {
      const { user } = renderDialog();
      await user.type(screen.getByRole("textbox", { name: "Name" }), "Article");
      await user.click(
        screen.getByRole("button", { name: "Browse all templates" })
      );
      const gallery = await screen.findByRole("dialog", {
        name: "All templates",
      });
      await user.click(
        within(gallery).getByRole("button", { name: "Use Acme double" })
      );
      await waitFor(() =>
        expect(checks.map(each => each.address)).toEqual(
          expect.arrayContaining(["blog-posts", "blog_posts"])
        )
      );
      const pendingFor = (address: string) =>
        checks
          .filter(each => each.address === address)
          .at(-1)
          ?.pending.map(each => `${each.kind}:${each.address}`);
      expect(pendingFor("blog-posts")).toEqual(
        expect.arrayContaining(["collection:blog_posts", "collection:article"])
      );
      expect(pendingFor("blog_posts")).toEqual(
        expect.arrayContaining(["collection:blog-posts", "collection:article"])
      );
    } finally {
      remove();
    }
  });
});
