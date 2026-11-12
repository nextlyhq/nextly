/**
 * The schema the field-group and Single delete refusals are tested against: a
 * field group something uses in each way it can be used, a Single, and the
 * plugins that key their tables or add to them.
 *
 * Shared by the field-group and the Single suites, so both refuse over the
 * same plugins. The live-catalog readers come from the collection suites'
 * fixtures, so every delete refusal is checked against one reading of the
 * database.
 */
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  text,
} from "../../../../config";
import { definePlugin } from "../../../../plugins/plugin-context";
import { col, defineTable } from "../../../schema/extension/dsl";
import { resolveComponentTableName } from "../../../schema/utils/resolve-table-name";

/** The field group every field-group suite tries to delete. */
export const SEO = "dep_seo";
export const SEO_TABLE = resolveComponentTableName(SEO);

/** The hosts that place SEO: a collection (at the top and inside a group), a Single and a field group. */
export const ARTICLES = "dep_articles";
export const ARTICLES_TABLE = `dc_${ARTICLES}`;
export const HOME = "dep_home";
export const HOME_TABLE = `single_${HOME}`;
export const CARD = "dep_card";

/** SEO, translated, so a teardown would have translations to remove. */
export const seoGroup = defineFieldGroup({
  slug: SEO,
  localized: true,
  fields: [text({ name: "heading", localized: true }), text({ name: "tone" })],
});

/** SEO with nothing translated, for the suites that need no languages. */
export const plainSeoGroup = defineFieldGroup({
  slug: SEO,
  fields: [text({ name: "heading" })],
});

export const articles = defineCollection({
  slug: ARTICLES,
  localized: true,
  fields: [
    text({ name: "title", localized: true }),
    fieldGroup({ name: "seo", component: SEO }),
    group({
      name: "extra",
      fields: [fieldGroup({ name: "more", component: SEO })],
    }),
  ],
});

export const home = defineSingle({
  slug: HOME,
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "seo", component: SEO }),
  ],
});

/** A Single nothing places a field group in, for the Single suites. */
export const plainHome = defineSingle({
  slug: HOME,
  fields: [text({ name: "title" })],
});

export const cardGroup = defineFieldGroup({
  slug: CARD,
  fields: [
    group({
      name: "meta",
      fields: [fieldGroup({ name: "seo", component: SEO })],
    }),
  ],
});

/** The languages a translated suite boots with. */
export const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };

/** The message a delete of SEO gets while every host above places it. */
export const PLACED_MESSAGE = `"${SEO}" cannot be deleted while other schema depends on it. Fields that place it: ${ARTICLES}.seo, ${ARTICLES}.extra.more, the Single ${HOME}.seo, the field group ${CARD}.meta.seo. Remove those fields, or have them place another field group, then delete "${SEO}".`;

/** A plugin whose own table has a declared foreign key to `target`. */
export function linksPluginTo(target: string) {
  return definePlugin({
    name: LINKS_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        prefix: "fgdeplinks",
        tables: [
          defineTable(
            "links",
            { id: col.id(), targetId: col.shortText({ nullable: true }) },
            {
              foreignKeys: [
                {
                  columns: ["targetId"],
                  references: { table: target, columns: ["id"] },
                },
              ],
            }
          ),
        ],
      },
    },
  });
}
export const LINKS_PLUGIN = "@t/fg-dep-links";
export const LINKS_TABLE = "fgdeplinks__links";

/** A plugin that adds a hidden column, and an index on it, to `target`. */
export function markerPluginOn(target: string) {
  return definePlugin({
    name: MARKER_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        extend: [
          ({ schema }) => {
            schema.extendTable(target, {
              columns: { [MARKER_COLUMN]: col.shortText({ nullable: true }) },
              indexes: [{ columns: [MARKER_COLUMN] }],
            });
          },
        ],
      },
    },
  });
}
export const MARKER_PLUGIN = "@t/fg-dep-marker";
export const MARKER_COLUMN = "marker";
