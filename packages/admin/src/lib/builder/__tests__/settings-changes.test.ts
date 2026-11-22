/**
 * Which of an entity's settings changed, each named as the Builder names it,
 * with what it was and what it is: the one answer the pending count, the undo
 * announcements and the save's review read. A setting that reaches the API
 * but not this list would be saved without being counted or reviewed, so
 * every key is driven from the value shape: a new setting with no entry here
 * fails to compile.
 */
import { describe, expect, it } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";

import { settingChanges } from "../settings-changes";

const base: BuilderSettingsValues = {
  singularName: "Post",
  pluralName: "Posts",
  slug: "posts",
  description: "",
  icon: "FileText",
  category: undefined,
  status: true,
  i18n: false,
  versions: false,
};

describe("settingChanges", () => {
  it("finds none in an unchanged copy", () => {
    expect(settingChanges(base, { ...base })).toEqual([]);
  });

  // Every setting a person can change, named in the Builder's words. The
  // starting field is chosen once, at create, and is no setting after it.
  const changed: Record<
    Exclude<keyof BuilderSettingsValues, "startingFieldType">,
    [BuilderSettingsValues, string, string, string]
  > = {
    singularName: [
      { ...base, singularName: "Article" },
      "name",
      "Post",
      "Article",
    ],
    pluralName: [
      { ...base, pluralName: "Articles" },
      "plural name",
      "Posts",
      "Articles",
    ],
    slug: [{ ...base, slug: "articles" }, "address", "posts", "articles"],
    description: [
      { ...base, description: "Now described" },
      "description",
      "",
      "Now described",
    ],
    icon: [{ ...base, icon: "Database" }, "icon", "FileText", "Database"],
    category: [{ ...base, category: "Layout" }, "category", "", "Layout"],
    status: [{ ...base, status: false }, "drafts and publishing", "on", "off"],
    i18n: [{ ...base, i18n: true }, "translation", "off", "on"],
    versions: [{ ...base, versions: true }, "version history", "off", "on"],
    versionsMaxPerDoc: [
      { ...base, versionsMaxPerDoc: 10 },
      "versions kept",
      "the default",
      "10",
    ],
    revalidate: [
      { ...base, revalidate: false },
      "cache revalidation",
      "on",
      "off",
    ],
    webhooks: [{ ...base, webhooks: false }, "webhook recording", "on", "off"],
  };

  for (const [key, [next, label, from, to]] of Object.entries(changed)) {
    it(`names a change of ${key} as ${label}, from ${from || "nothing"} to ${to}`, () => {
      expect(settingChanges(base, next)).toEqual([{ key, label, from, to }]);
    });
  }

  it("counts no change for a switch left unset where it reads as its default", () => {
    const unset = { ...base, status: undefined, revalidate: undefined };
    expect(
      settingChanges(unset, { ...unset, status: false, revalidate: true })
    ).toEqual([]);
  });

  it("counts no change between a text setting left unset and one left blank", () => {
    expect(
      settingChanges(
        { ...base, description: undefined },
        { ...base, description: "" }
      )
    ).toEqual([]);
  });

  it("counts no change of the starting field, which is no setting after create", () => {
    expect(
      settingChanges(base, { ...base, startingFieldType: "blocks" })
    ).toEqual([]);
  });

  it("names a retention of no limit", () => {
    expect(
      settingChanges(
        { ...base, versionsMaxPerDoc: 10 },
        { ...base, versionsMaxPerDoc: false }
      )
    ).toEqual([
      {
        key: "versionsMaxPerDoc",
        label: "versions kept",
        from: "10",
        to: "no limit",
      },
    ]);
  });

  it("lists several changes in the order the settings show them", () => {
    expect(
      settingChanges(base, {
        ...base,
        webhooks: false,
        singularName: "Article",
      }).map(change => change.key)
    ).toEqual(["singularName", "webhooks"]);
  });
});
