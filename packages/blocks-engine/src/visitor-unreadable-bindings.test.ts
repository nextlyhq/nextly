/**
 * The bound props a visitor will not see: marked exactly when the published
 * page's own binding check falls back for a field visitors may not read, and
 * never on a guess.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape, BindingSchemaRef } from "./binding-rules";
import type { BlockDocument, BlockNode } from "./document";
import { visitorUnreadableBindings } from "./visitor-unreadable-bindings";

/** The fields a visitor may read, by source. `internalNote` is not among them. */
const PUBLIC: Record<string, readonly BindingFieldShape[]> = {
  "collection:posts": [
    { name: "title", type: "text" },
    { name: "author", type: "relationship", relationTo: "users" },
  ],
  "collection:users": [{ name: "name", type: "text" }],
  "single:footer": [{ name: "tagline", type: "text" }],
};

const schema = {
  fieldsOf: (ref: BindingSchemaRef) =>
    "collection" in ref
      ? PUBLIC[`collection:${ref.collection}`]
      : "single" in ref
        ? PUBLIC[`single:${ref.single}`]
        : undefined,
};

const heading = (id: string, bindings: Record<string, unknown>): BlockNode =>
  ({
    id,
    type: "core/heading",
    version: 1,
    props: { text: "Own text", level: "h2" },
    bindings,
  }) as BlockNode;

const page = (...nodes: BlockNode[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as BlockDocument;

const entryRef = { collection: "posts" };

describe("the bound props a visitor will not see", () => {
  it("marks a binding to a field visitors may not read, with its fallback", () => {
    const marked = visitorUnreadableBindings(
      page(
        heading("note", {
          text: { $bind: "internalNote", fallback: "Coming soon" },
        }),
        heading("title", { text: { $bind: "title" } })
      ),
      { schema, entryRef }
    );
    // The public field beside it is the control: same block, same source.
    expect([...marked.keys()]).toEqual(["note"]);
    expect(marked.get("note")).toEqual([
      {
        prop: "text",
        path: "internalNote",
        fallback: { value: "Coming soon" },
      },
    ]);
  });

  it("follows a relation into the related collection's public fields", () => {
    const marked = visitorUnreadableBindings(
      page(
        heading("email", { text: { $bind: "author.email" } }),
        heading("name", { text: { $bind: "author.name" } })
      ),
      { schema, entryRef }
    );
    expect([...marked.keys()]).toEqual(["email"]);
    expect(marked.get("email")?.[0]?.path).toBe("author.email");
  });

  it("judges a Single by its own public fields", () => {
    const marked = visitorUnreadableBindings(
      page(
        heading("secret", {
          text: { $bind: "phone", source: "single", sourceKey: "footer" },
        }),
        heading("tagline", {
          text: { $bind: "tagline", source: "single", sourceKey: "footer" },
        })
      ),
      { schema, entryRef }
    );
    expect([...marked.keys()]).toEqual(["secret"]);
  });

  it("finds a binding nested in a container's slot", () => {
    const section = {
      id: "section",
      type: "core/section",
      version: 1,
      props: {},
      slots: {
        children: [heading("inner", { text: { $bind: "internalNote" } })],
      },
    } as BlockNode;
    const marked = visitorUnreadableBindings(page(section), {
      schema,
      entryRef,
    });
    expect([...marked.keys()]).toEqual(["inner"]);
  });

  it("marks nothing on a guess", () => {
    const document = page(
      // A field every entry carries, which no shape lists.
      heading("id", { text: { $bind: "id" } }),
      // The site settings: their own public allowlist, the same for everyone.
      heading("site", { text: { $bind: "secretKey", source: "site" } }),
      // A list item: judged by its list's rows, not here.
      heading("item", { text: { $bind: "internalNote", source: "item" } }),
      // A Single whose shapes are not known.
      heading("unknown", {
        text: { $bind: "phone", source: "single", sourceKey: "header" },
      })
    );
    expect(visitorUnreadableBindings(document, { schema, entryRef }).size).toBe(
      0
    );
    // And without the entry's ref, the entry's shapes are not known either.
    expect(
      visitorUnreadableBindings(
        page(heading("note", { text: { $bind: "internalNote" } })),
        { schema }
      ).size
    ).toBe(0);
  });

  it("marks every binding to a source the public may read none of", () => {
    // `contact` has no public field at all, so the published page reads none
    // of it; the person editing reads it, so the host says it is unreadable.
    const marked = visitorUnreadableBindings(
      page(
        heading("phone", {
          text: {
            $bind: "phone",
            source: "single",
            sourceKey: "contact",
            fallback: "Call us",
          },
        }),
        heading("tagline", {
          text: { $bind: "tagline", source: "single", sourceKey: "footer" },
        })
      ),
      {
        schema,
        entryRef,
        unreadableSource: ref => "single" in ref && ref.single === "contact",
      }
    );
    expect([...marked.keys()]).toEqual(["phone"]);
    expect(marked.get("phone")).toEqual([
      { prop: "text", path: "phone", fallback: { value: "Call us" } },
    ]);
    // The control: without the host's word, unknown shapes mark nothing.
    expect(
      visitorUnreadableBindings(
        page(
          heading("phone", {
            text: { $bind: "phone", source: "single", sourceKey: "contact" },
          })
        ),
        { schema, entryRef }
      ).size
    ).toBe(0);
  });

  it("marks a path into a related collection the public reads none of", () => {
    // `author` is a public relation, but `users` has no public field, so the
    // published page cannot read the author at all.
    const marked = visitorUnreadableBindings(
      page(
        heading("email", { text: { $bind: "author.email" } }),
        heading("title", { text: { $bind: "title" } })
      ),
      {
        schema: {
          fieldsOf: ref =>
            "collection" in ref && ref.collection === "posts"
              ? PUBLIC["collection:posts"]
              : undefined,
        },
        entryRef,
        unreadableSource: ref =>
          "collection" in ref && ref.collection === "users",
      }
    );
    // The control, `title`, reads no relation.
    expect([...marked.keys()]).toEqual(["email"]);
    expect(marked.get("email")?.[0]?.path).toBe("author.email");
  });
});
