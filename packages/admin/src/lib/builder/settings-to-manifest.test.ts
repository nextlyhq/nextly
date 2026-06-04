import { describe, expect, it } from "vitest";

import {
  collectionEntityFromSettings,
  singleEntityFromSettings,
} from "./settings-to-manifest";

const FIELDS = [{ name: "headline", type: "text", required: false }];

describe("collectionEntityFromSettings", () => {
  it("forwards status: true into the manifest entity", () => {
    const entity = collectionEntityFromSettings(
      "posts",
      {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        icon: "Database",
        status: true,
      },
      FIELDS
    );
    expect(entity.status).toBe(true);
    expect(entity.slug).toBe("posts");
    expect(entity.labels).toEqual({ singular: "Post", plural: "Posts" });
    expect(entity.fields.map(f => f.name)).toEqual(["headline"]);
  });

  it("writes status: false explicitly so Draft/Published can be turned off", () => {
    const entity = collectionEntityFromSettings(
      "posts",
      {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        icon: "Database",
        status: false,
      },
      FIELDS
    );
    expect(entity.status).toBe(false);
  });

  it("coerces an absent status to false (never undefined)", () => {
    const entity = collectionEntityFromSettings(
      "posts",
      {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        icon: "Database",
      },
      FIELDS
    );
    expect(entity.status).toBe(false);
  });
});

describe("singleEntityFromSettings", () => {
  it("forwards status: true and sets single labels from singularName", () => {
    const entity = singleEntityFromSettings(
      "home_hero",
      {
        singularName: "Home Hero",
        slug: "home_hero",
        icon: "FileText",
        status: true,
      },
      FIELDS
    );
    expect(entity.status).toBe(true);
    expect(entity.labels).toEqual({
      singular: "Home Hero",
      plural: "Home Hero",
    });
  });

  it("writes status: false explicitly", () => {
    const entity = singleEntityFromSettings(
      "home_hero",
      {
        singularName: "Home Hero",
        slug: "home_hero",
        icon: "FileText",
        status: false,
      },
      FIELDS
    );
    expect(entity.status).toBe(false);
  });
});
