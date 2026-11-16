"use client";

/**
 * The admin, mounted as an application mounts it: one catch-all page that
 * renders the admin's root layout, which routes every address under
 * `/admin` itself.
 *
 * It enters the package only through its public entry, and registers its
 * plugin's components as an application does: by importing the generated
 * component map, which imports the plugin's admin module, which builds its
 * page from parts it imports through `@nextlyhq/plugin-sdk/admin`.
 */
import "./plugin-admin-imports.generated";
import { RootLayout } from "@nextlyhq/admin";

export default function AdminPage() {
  return <RootLayout />;
}
