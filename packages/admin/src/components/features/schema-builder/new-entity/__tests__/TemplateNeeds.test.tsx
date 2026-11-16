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
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: async (kind: string, address: string) => ({
      kind,
      address,
      refusal: refusals[`${kind}:${address}`] ?? null,
    }),
  },
}));

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
    await user.type(screen.getByLabelText("Name"), "Article");

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
    await user.type(screen.getByLabelText("Name"), "Article");
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

  it("makes nothing for a collection that exists, or waits unsaved", async () => {
    refusals = {
      "collection:authors": {
        code: "DUPLICATE",
        message: "Resource already exists.",
      },
    };
    const { onCreate, user } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Blog posts/ }));
    await user.type(screen.getByLabelText("Name"), "Article");
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
    await user.type(screen.getByLabelText("Name"), "Article");
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
    await user.type(screen.getByLabelText("Name"), "Authors");
    await waitFor(() => expect(createButton()).toBeEnabled());
    expect(
      within(picked()).queryByRole("checkbox", {
        name: "Create the collection authors too",
      })
    ).toBeNull();
    await user.click(createButton());
    expect(onCreate.mock.calls.at(-1)?.[2]).toEqual([]);
  });
});
