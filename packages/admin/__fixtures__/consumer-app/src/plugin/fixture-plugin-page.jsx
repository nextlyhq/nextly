"use client";

/**
 * The component a plugin contributes as an admin page, built from plugin-page
 * parts it imports through `@nextlyhq/plugin-sdk/admin`, as a plugin does.
 *
 * It names only those parts: its admin module is imported with the admin's
 * first load (the generated map imports it), so the first load may hold the
 * parts it names and must not hold the kit's other areas, the media library
 * or the field-UI kit.
 */
import { SettingsRowGroup, Stepper } from "@nextlyhq/plugin-sdk/admin";

export function FixturePluginPage() {
  return (
    <div data-testid="fixture-plugin-page">
      <p>Fixture plugin page</p>
      <Stepper steps={[{ label: "One" }]} current={0} aria-label="Setup" />
      <SettingsRowGroup label="Settings">{null}</SettingsRowGroup>
    </div>
  );
}
