/**
 * The document the editor seeds must be one the field will accept.
 *
 * Asserted against the FIELD'S OWN VALIDATOR rather than against the kind
 * string, because the kind is not the property that matters — "the save
 * succeeds" is. A test comparing `documentFrom(null).kind` to `"pattern"`
 * would pass on an editor that seeded a well-formed document the server
 * refuses for some other reason, and would have to be rewritten every time the
 * default changes.
 *
 * The failure it exists to catch shipped: `documentFrom` defaulted to a `page`
 * document regardless of the field, so creating a Pattern or a Component in
 * the admin produced an editor that looked like it worked and a save the
 * server rejected with `DISALLOWED_DOCUMENT_KIND`. Every test in the suite
 * asserted declarations, and none of them opened the create flow.
 */
import { describe, expect, it } from "vitest";

import { componentsCollection } from "../collections/components";
import { patternsCollection } from "../collections/patterns";
import { acceptedKinds } from "../fields/blocks-options";
import { blocksFieldType } from "../fields/blocksField";

import { documentFrom } from "./BlocksField";

/** The `content` field as its collection declares it. */
function contentFieldOf(collection: { fields: unknown }): { blocks?: unknown } {
  const field = (collection.fields as { name?: string }[]).find(
    f => f.name === "content"
  );
  if (!field) throw new Error("the collection declares no content field");
  return field;
}

/** What the registered type says about a value written to that field. */
function validateAgainst(declaration: { blocks?: unknown }, value: unknown) {
  const type = blocksFieldType() as {
    validate: (
      value: unknown,
      args: { data: object; req: object; field: unknown; path: string }
    ) => true | { code?: string }[];
  };
  return type.validate(value, {
    data: {},
    req: {},
    field: declaration,
    path: "content",
  });
}

describe("a new document is seeded as a kind its own field accepts", () => {
  it.each([
    ["patterns", patternsCollection],
    ["components", componentsCollection],
  ])("%s accepts what the create form seeds into it", (_label, build) => {
    const declaration = contentFieldOf(build());

    // Through `acceptedKinds`, which is what the component calls — not by
    // reading `blocks.kinds` here. A test that reached the kinds by its own
    // route would keep passing with that reader returning nothing, which is
    // precisely the state in which the editor seeds a page again.
    const seeded = documentFrom(null, acceptedKinds(declaration));

    expect(validateAgainst(declaration, seeded)).toBe(true);
  });

  it("still refuses a page document written to a pattern field", () => {
    // The control. Without it the assertions above are satisfied by a
    // validator that accepts everything — which is also what a broken `kinds`
    // declaration would look like from here.
    const declaration = contentFieldOf(patternsCollection());
    const pageDocument = documentFrom(null, ["page"]);

    expect(validateAgainst(declaration, pageDocument)).not.toBe(true);
  });

  it("seeds a page when the field declares no kinds", () => {
    // The other control: a field that says nothing still gets a page, so the
    // change reaches only the fields that asked for something else.
    expect(documentFrom(null).kind).toBe("page");
  });
});
