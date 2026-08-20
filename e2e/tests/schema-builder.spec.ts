/**
 * The three schema-builder edit pages — collection, single, field group —
 * against a real server and a real database.
 *
 * They draw from one shared frame, so a defect in that frame breaks all three
 * at once and breaks them identically. Unit tests cover the hooks the frame is
 * built from; what they cannot see is whether the assembled page still renders,
 * still knows which fields are the user's, and still refuses to save a
 * code-first entity. Each of those is a whole-page property.
 *
 * The playground defines every seeded entity in code, so these all load LOCKED.
 * That is the read-only path rather than a limitation: it is the state a
 * contributor opening the playground actually sees, and nothing else exercises
 * it end to end.
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

interface BuilderKind {
  /** Reads into the test name. */
  label: string;
  path: string;
  /** The entity's display name, shown in the toolbar. */
  entity: string;
  /**
   * A field this entity declares itself, which must reach the field list. Held
   * per kind because each seeded entity has its own shape, and asserting on a
   * field none of them share would only prove the page drew something.
   */
  ownField: string;
}

const KINDS: BuilderKind[] = [
  {
    label: "collection",
    path: "/builder/collections/posts",
    entity: "Post",
    ownField: "excerpt",
  },
  {
    label: "single",
    path: "/builder/singles/homepage",
    entity: "Homepage",
    ownField: "Layout",
  },
  {
    label: "field group",
    path: "/builder/field-groups/seo",
    entity: "SEO Metadata",
    ownField: "Meta Title",
  },
];

/**
 * Leaf elements whose whole text is `name`.
 *
 * Counted in the page rather than with a locator because the question is how
 * MANY times a field name appears anywhere in the builder, and a locator that
 * resolves to several nodes is an error rather than an answer. Leaves only, so
 * a container that happens to wrap one name is not counted twice.
 */
function occurrences(page: Page, name: string): Promise<number> {
  return page.evaluate(
    needle =>
      Array.from(document.querySelectorAll("main *")).filter(
        el => el.children.length === 0 && el.textContent?.trim() === needle
      ).length,
    name
  );
}

for (const kind of KINDS) {
  test(`${kind.label} builder draws without a server error`, async ({
    page,
  }) => {
    const serverErrors: string[] = [];
    const crashes: string[] = [];
    page.on("response", r => {
      if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", e => crashes.push(e.message));

    await gotoAdmin(page, kind.path);

    // The entity's name, which only the loaded record supplies — so this also
    // says the page gate opened, rather than sitting on its loading screen or
    // falling through to the not-found one.
    await expect(
      page.getByText(kind.entity, { exact: true }).first()
    ).toBeVisible();

    expect(serverErrors, "requests that 500'd").toEqual([]);
    expect(crashes, "uncaught exceptions").toEqual([]);
  });

  test(`${kind.label} builder lists the entity's own fields`, async ({
    page,
  }) => {
    await gotoAdmin(page, kind.path);

    // A field the seeded entity declares. Its presence is what separates a
    // page that loaded the record from one that rendered an empty frame:
    // system fields are prepended from a constant and would show either way.
    await expect(
      page.getByText(kind.ownField, { exact: true }).first()
    ).toBeVisible();
  });

  test(`${kind.label} builder keeps system fields out of the user's fields`, async ({
    page,
  }) => {
    await gotoAdmin(page, kind.path);
    await expect(
      page.getByText(kind.ownField, { exact: true }).first()
    ).toBeVisible();

    // `title` and `slug` are the server's. The builder prepends its own copies
    // and drops the ones the record carries, so each must appear exactly once
    // however many times the record itself declares them — `posts` and
    // `homepage` both declare `title`, and a page showing it twice would be
    // offering to edit a field the save then refuses to send.
    //
    // Only those two kinds control the DROP: `seo` declares no system-named
    // field, so its count stays 1 whether the filter runs or not. Verified by
    // emptying the name list — collection and single fail here at 2, field
    // group passes. The field-group case still covers the PREPEND, which is
    // why it runs; it is simply not evidence about the filter.
    expect(await occurrences(page, "title"), "occurrences of title").toBe(1);
    expect(await occurrences(page, "slug"), "occurrences of slug").toBe(1);

    // Collapsing the system row unmounts every one of them, so anything still
    // named `title` or `slug` afterwards is in the USER's list rather than the
    // system one. Counting alone cannot tell those apart; this can, and it does
    // it without depending on how either region is styled.
    await page.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Hide", exact: true })
    ).toBeHidden();

    expect(
      await occurrences(page, "title"),
      "title outside the system row"
    ).toBe(0);
    expect(await occurrences(page, "slug"), "slug outside the system row").toBe(
      0
    );
  });

  test(`${kind.label} builder refuses to save a code-first entity`, async ({
    page,
  }) => {
    await gotoAdmin(page, kind.path);

    await expect(
      page.getByText("Read-only — defined in code", { exact: true })
    ).toBeVisible();

    // The toolbar gates Save on the entity being locked OR nothing having
    // changed, and a locked page can never satisfy the second — so this cannot
    // tell the two apart, and it is NOT evidence that the locked half still
    // works. Confirmed by forcing the page unlocked: the notice above fails and
    // this stays green. It is here because a Save that became ENABLED on a
    // read-only entity is worth catching whichever half broke.
    await expect(
      page.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();

    // The settings button changes its accessible name when locked, which is
    // the only thing telling a screen-reader user the panel is not editable.
    await expect(
      page.getByRole("button", { name: "View settings" })
    ).toBeVisible();
  });
}
