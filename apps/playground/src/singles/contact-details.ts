/**
 * Contact details — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * It exists for the browser test of a bound value a visitor will not see: a
 * Single the public reads, with one field it may read and one it may not, so
 * a page bound to each shows the editor which one the published page falls
 * back on. No playground Single has a field the public may not read, and
 * adding one would change what it is for in every development run.
 */
import { defineSingle, text, upload } from "nextly/config";

export const ContactDetails = defineSingle({
  slug: "contact-details",
  label: { singular: "Contact details" },
  // The public reads this Single, as a page's binding does; the protected
  // field below is withheld by its own rule.
  access: { read: () => true },
  fields: [
    text({ name: "phone", label: "Phone" }),
    text({
      name: "internalNote",
      label: "Internal note",
      access: { read: ({ user }) => user !== null },
    }),
    // Visitors may read it, so a builder's binding pickers list it: the
    // browser test of an image bound to an upload field reads this one.
    upload({ name: "logo", label: "Logo", relationTo: "media" }),
  ],
});
