import { defineSingle, text, upload } from "@revnixhq/nextly/config";

export default defineSingle({
  slug: "site-settings",
  label: { singular: "Site Settings" },
  admin: {
    group: "Settings",
    icon: "Settings",
    description: "Global site configuration",
  },
  fields: [
    text({ name: "siteName", required: true, label: "Site Name" }),
    text({ name: "tagline", label: "Tagline" }),
    upload({ name: "logo", relationTo: "media", label: "Logo" }),
    upload({ name: "favicon", relationTo: "media", label: "Favicon" }),
  ],
});
