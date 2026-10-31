"use client";

/**
 * The admin, mounted as an application mounts it: one catch-all page that
 * renders the admin's root layout, which routes every address under
 * `/admin` itself.
 *
 * It enters the package only through its public entry, and registers a
 * plugin page's component there as a plugin's admin module does, at load.
 */
import { RootLayout, registerComponents } from "@nextlyhq/admin";

import { FixturePluginPage } from "../../../plugin/fixture-plugin-page";

registerComponents({
  "@fixture/consumer-plugin/admin#FixturePluginPage": FixturePluginPage,
});

export default function AdminPage() {
  return <RootLayout />;
}
