import {
  defineSingle,
  text,
  textarea,
  checkbox,
  chips,
} from "@revnixhq/nextly/config";

const TestSettings = defineSingle({
  slug: "test-settings",
  label: { singular: "Test Settings" },
  admin: {
    description: "Full-flow test single with mixed field types",
  },
  fields: [
    text({
      name: "siteTitle",
      label: "Site Title",
      required: true,
    }),
    textarea({
      name: "siteDescription",
      label: "Site Description",
    }),
    checkbox({
      name: "maintenanceMode",
      label: "Maintenance Mode",
      defaultValue: false,
    }),
    chips({
      name: "allowedDomains",
      label: "Allowed Domains",
      admin: {
        placeholder: "e.g. example.com",
        description: "Domains allowed to access the site",
      },
    }),
    chips({
      name: "featureFlags",
      label: "Feature Flags",
      maxChips: 10,
      admin: {
        placeholder: "Add a feature flag",
      },
    }),
  ],
});

export default TestSettings;
