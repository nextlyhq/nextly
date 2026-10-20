/**
 * History notes — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * It exists for the history browser test: a document whose fields sit in the
 * layouts a past version must keep — a plain field, a group, and an embedded
 * field group (a component) — so the test can show a version reads in the
 * editor's own layout with its changed fields marked. Posts has none of these
 * containers, and adding them there would change what it is for in every
 * development run.
 */
import {
  defineCollection,
  fieldGroup,
  group,
  text,
  textarea,
} from "nextly/config";

export const HistoryNotes = defineCollection({
  slug: "history-notes",
  labels: { singular: "History note", plural: "History notes" },
  status: true,
  versions: { drafts: true },
  fields: [
    text({ name: "title", label: "Title", required: true }),
    textarea({ name: "summary", label: "Summary" }),
    group({
      name: "details",
      label: "Details",
      fields: [
        text({ name: "subtitle", label: "Subtitle" }),
        text({ name: "byline", label: "Byline" }),
      ],
    }),
    fieldGroup({ name: "seo", component: "seo", label: "SEO" }),
  ],
});
