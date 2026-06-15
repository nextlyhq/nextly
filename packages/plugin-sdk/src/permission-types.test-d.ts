import type { PermissionSlug, PluginPermission } from "@nextlyhq/plugin-sdk";

// PluginPermission requires action + resource, allows optional metadata.
const p: PluginPermission = {
  action: "export",
  resource: "submissions",
  label: "Export Submissions",
};

// PermissionSlug is assignable from a slug string (codegen narrows it in P6, D47).
const s: PermissionSlug = "export-submissions";

// Exported so eslint does not flag the assertions as unused.
export const __permissionTypeCheck = { p, s };
