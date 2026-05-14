import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";

import {
  deriveCollectionSchemas,
  deriveNestedItemSchemas,
} from "./derive-schemas";

describe("deriveCollectionSchemas", () => {
  const Posts: CollectionConfig = {
    slug: "posts",
    labels: { singular: "Post", plural: "Posts" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "body", type: "textarea" },
      { name: "author", type: "relationship", relationTo: "users" },
    ],
  };

  it("baseName is the singularized PascalCase form", () => {
    const { baseName } = deriveCollectionSchemas(Posts);
    expect(baseName).toBe("Post");
  });

  it("emits Post, CreatePost, UpdatePost", () => {
    const { schemas } = deriveCollectionSchemas(Posts);
    expect(Object.keys(schemas).sort()).toEqual([
      "CreatePost",
      "Post",
      "UpdatePost",
    ]);
  });

  it("Post (read) includes readOnly id + createdAt + updatedAt (timestamps default true)", () => {
    const { schemas } = deriveCollectionSchemas(Posts);
    const post = schemas.Post as {
      properties?: Record<string, Record<string, unknown>>;
    };
    expect(post.properties?.id).toMatchObject({
      type: "string",
      readOnly: true,
    });
    expect(post.properties?.createdAt).toMatchObject({
      type: "string",
      format: "date-time",
      readOnly: true,
    });
    expect(post.properties?.updatedAt).toMatchObject({
      type: "string",
      format: "date-time",
      readOnly: true,
    });
  });

  it("Post.author uses the relationship mapper's honest oneOf", () => {
    const { schemas } = deriveCollectionSchemas(Posts);
    const author = (
      schemas.Post as {
        properties?: Record<string, unknown>;
      }
    ).properties?.author;
    expect(author).toEqual(
      expect.objectContaining({
        oneOf: [{ type: "string" }, { $ref: "#/components/schemas/User" }],
      })
    );
  });

  it("CreatePost omits id/createdAt/updatedAt and keeps user fields", () => {
    const { schemas } = deriveCollectionSchemas(Posts);
    const create = schemas.CreatePost as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(create.properties).not.toHaveProperty("id");
    expect(create.properties).not.toHaveProperty("createdAt");
    expect(create.properties).not.toHaveProperty("updatedAt");
    expect(create.properties).toHaveProperty("title");
    expect(create.properties).toHaveProperty("body");
    expect(create.required).toEqual(["title"]);
  });

  it("UpdatePost has same properties as Create but no required key", () => {
    const { schemas } = deriveCollectionSchemas(Posts);
    const update = schemas.UpdatePost as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(update.properties).toHaveProperty("title");
    expect(update.properties).toHaveProperty("body");
    expect(update).not.toHaveProperty("required");
  });

  it("omits createdAt / updatedAt when timestamps: false", () => {
    const NoTs: CollectionConfig = { ...Posts, timestamps: false };
    const { schemas } = deriveCollectionSchemas(NoTs);
    const post = schemas.Post as { properties?: Record<string, unknown> };
    expect(post.properties).not.toHaveProperty("createdAt");
    expect(post.properties).not.toHaveProperty("updatedAt");
    expect(post.properties).toHaveProperty("id");
  });

  it("adds _status enum when status: true", () => {
    const WithStatus: CollectionConfig = { ...Posts, status: true };
    const { schemas } = deriveCollectionSchemas(WithStatus);
    const post = schemas.Post as { properties?: Record<string, unknown> };
    expect(post.properties?._status).toEqual({
      type: "string",
      enum: ["draft", "published"],
      readOnly: true,
    });
  });

  it("omits _status when status: false or unset", () => {
    const { schemas } = deriveCollectionSchemas(Posts);
    const post = schemas.Post as { properties?: Record<string, unknown> };
    expect(post.properties).not.toHaveProperty("_status");
  });

  it("password fields appear in CreatePost but NOT in Post (read)", () => {
    const WithPwd: CollectionConfig = {
      slug: "users",
      labels: { singular: "User" },
      fields: [
        { name: "email", type: "email" },
        { name: "password", type: "password", required: true },
      ],
    };
    const { schemas } = deriveCollectionSchemas(WithPwd);
    const read = schemas.User as { properties?: Record<string, unknown> };
    const create = schemas.CreateUser as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(read.properties).not.toHaveProperty("password");
    expect(create.properties).toHaveProperty("password");
    expect(create.required).toContain("password");
  });

  it("uses labels.singular when set (handles English exceptions)", () => {
    const People: CollectionConfig = {
      slug: "people",
      labels: { singular: "Person" },
      fields: [{ name: "name", type: "text" }],
    };
    const { baseName, schemas } = deriveCollectionSchemas(People);
    expect(baseName).toBe("Person");
    expect(schemas.Person).toBeDefined();
    expect(schemas.CreatePerson).toBeDefined();
    expect(schemas.UpdatePerson).toBeDefined();
  });

  it("infers from slug when labels.singular is absent (kebab-case)", () => {
    const Providers: CollectionConfig = {
      slug: "email-providers",
      fields: [{ name: "name", type: "text" }],
    };
    const { baseName, schemas } = deriveCollectionSchemas(Providers);
    expect(baseName).toBe("EmailProvider");
    expect(schemas.EmailProvider).toBeDefined();
    expect(schemas.CreateEmailProvider).toBeDefined();
  });
});

describe("deriveNestedItemSchemas", () => {
  it("registers a flat Post__BlocksItem for a top-level repeater", () => {
    const Posts: CollectionConfig = {
      slug: "posts",
      labels: { singular: "Post" },
      fields: [
        {
          name: "blocks",
          type: "repeater",
          fields: [
            { name: "heading", type: "text" },
            { name: "body", type: "textarea" },
          ],
        },
      ],
    };
    const items = deriveNestedItemSchemas(Posts, "Post");
    expect(items.Post__BlocksItem).toBeDefined();
    expect(items.Post__BlocksItem).toMatchObject({
      type: "object",
      properties: {
        heading: { type: "string" },
        body: { type: "string" },
      },
    });
  });

  it("uses PascalCase for snake/kebab field names: social_links -> SocialLinksItem", () => {
    const Posts: CollectionConfig = {
      slug: "posts",
      labels: { singular: "Post" },
      fields: [
        {
          name: "social_links",
          type: "repeater",
          fields: [{ name: "url", type: "text" }],
        },
      ],
    };
    const items = deriveNestedItemSchemas(Posts, "Post");
    expect(Object.keys(items)).toEqual(["Post__SocialLinksItem"]);
  });

  it("recurses into nested repeaters", () => {
    const Posts: CollectionConfig = {
      slug: "posts",
      labels: { singular: "Post" },
      fields: [
        {
          name: "sections",
          type: "repeater",
          fields: [
            { name: "title", type: "text" },
            {
              name: "items",
              type: "repeater",
              fields: [{ name: "label", type: "text" }],
            },
          ],
        },
      ],
    };
    const items = deriveNestedItemSchemas(Posts, "Post");
    expect(items.Post__SectionsItem).toBeDefined();
    expect(items.Post__ItemsItem).toBeDefined();
  });

  it("recurses into named groups containing repeaters", () => {
    const Posts: CollectionConfig = {
      slug: "posts",
      labels: { singular: "Post" },
      fields: [
        {
          name: "seo",
          type: "group",
          fields: [
            {
              name: "tags",
              type: "repeater",
              fields: [{ name: "label", type: "text" }],
            },
          ],
        },
      ],
    };
    const items = deriveNestedItemSchemas(Posts, "Post");
    expect(items.Post__TagsItem).toBeDefined();
  });

  it("returns an empty object when no repeaters exist", () => {
    const Posts: CollectionConfig = {
      slug: "posts",
      fields: [{ name: "title", type: "text" }],
    };
    const items = deriveNestedItemSchemas(Posts, "Post");
    expect(items).toEqual({});
  });
});
