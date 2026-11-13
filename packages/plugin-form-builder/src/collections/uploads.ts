/**
 * Form Uploads collection
 *
 * Every file a visitor uploaded through a form's upload route
 * (`POST /api/forms/:slug/upload`): the media item, the form and file field
 * it was uploaded for, and the submission that claimed it, if one has. A
 * submission a trusted write stored naming a file another already holds is
 * recorded beside it, one row per holder, so the file stays while any of
 * them is left. A
 * file answer in a submission a request writes may only name an upload
 * recorded here for the same form and field that no other submission has
 * claimed, so the files a submission holds are known to be its own and can
 * be deleted with it.
 *
 * `releasedAt` is set, in the deleting transaction, when the submission
 * holding an upload is deleted (or, for one never claimed, when it is given
 * up): from then on no submission may claim it, and once the deletion has
 * committed its file is deleted, unless something else uses it, and the row
 * with it. A row whose file could not be deleted yet stays released, and the
 * nightly retention pass tries again.
 *
 * Internal: never in the admin's navigation, records no webhook events, and
 * no caller reaches it; only this plugin, acting as itself, writes and reads
 * it.
 *
 * @module collections/uploads
 */

import { date, text, type CollectionConfig } from "@nextlyhq/plugin-sdk";

/** The slug the uploads are kept under. */
export const FORM_UPLOADS_SLUG = "form-uploads";

/** Nobody but the plugin itself, which acts as the system and skips this. */
const nobody = () => false;

export function formUploadsCollection(): CollectionConfig {
  return {
    slug: FORM_UPLOADS_SLUG,
    labels: { singular: "Form upload", plural: "Form uploads" },
    internal: true,
    // A media id and a form's field name are of no use to a delivery
    // subscriber, and a visitor's upload is not an event a site announces.
    webhooks: false,
    // `createdAt` is how old an upload no submission claimed is.
    timestamps: true,
    access: {
      read: nobody,
      create: nobody,
      update: nobody,
      delete: nobody,
    },
    fields: [
      // The media item's id, as a file answer names it.
      text({ name: "media", required: true }),
      // The form's id and the file field's name it was uploaded for.
      text({ name: "form", required: true }),
      text({ name: "field", required: true }),
      // The submission's id once one claims it; empty until then.
      text({ name: "submission" }),
      // When it stopped being claimable, its file to be deleted.
      date({ name: "releasedAt" }),
    ],
    indexes: [
      // One record per file and holder: a submission holds a file once. Led
      // by `media`, so it serves every lookup of a file's records too.
      { fields: ["media", "submission"], unique: true },
      { fields: ["submission"] },
      { fields: ["form"] },
    ],
  };
}
