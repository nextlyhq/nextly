import { defineCollection, text } from "nextly/config";

// A collection the dev-reload browser test edits while `next dev` runs: it adds
// a field to this file, saves it, and waits for the column. Registered only
// when NEXTLY_E2E_DEV_RELOAD=1, so a contributor's playground never has it, and
// the test puts this file back as it was when it finishes.
export const DevReloadProbe = defineCollection({
  slug: "dev_reload_probe",
  labels: { singular: "Dev reload probe", plural: "Dev reload probes" },
  fields: [text({ name: "title" })],
});
