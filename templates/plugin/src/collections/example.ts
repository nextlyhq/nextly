import { defineCollection, text, textarea } from "nextly/config";

/**
 * An example plugin-owned collection. Replace or remove it with your own.
 * Plugin collections are merged into the host schema automatically (D3/D12)
 * and get a real table on `nextly migrate` / boot.
 */
export const Examples = defineCollection({
  slug: "examples",
  labels: { singular: "Example", plural: "Examples" },
  fields: [text({ name: "title", required: true }), textarea({ name: "body" })],
  admin: { useAsTitle: "title" },
});
