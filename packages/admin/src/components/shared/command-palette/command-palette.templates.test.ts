/**
 * An app made from a template gets the command palette with no code of its
 * own, because the admin's root mounts it and every template's admin page
 * renders that root.
 *
 * The palette's mount is proven in the browser on the playground, which
 * renders the root the same way. This pins the other half: that each
 * template's admin page still renders `RootLayout` and mounts no palette of
 * its own, so a template that drifts from the playground fails here rather
 * than in a new app. Read as text: the page imports a stylesheet and files a
 * new app generates, which nothing here can load.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const TEMPLATES = resolve(__dirname, "../../../../../../templates");

/** Every template that serves the admin, by its catch-all admin page. */
const adminPages = readdirSync(TEMPLATES)
  .map(name => ({
    name,
    path: join(TEMPLATES, name, "src/app/admin/[[...params]]/page.tsx"),
  }))
  .filter(template => existsSync(template.path));

describe("the templates' admin pages", () => {
  it("are found, so the checks below run over something", () => {
    // POSITIVE CONTROL: the starter every new app is made from is among them.
    expect(adminPages.map(template => template.name)).toContain("base");
  });

  for (const template of adminPages) {
    it(`${template.name}: renders the admin's root and mounts no palette of its own`, () => {
      const source = readFileSync(template.path, "utf8");
      expect(source).toMatch(
        /import\s*\{[^}]*\bRootLayout\b[^}]*\}\s*from\s*"@nextlyhq\/admin"/
      );
      expect(source).toMatch(/<RootLayout\b[^>]*\/>/);
      expect(source).not.toMatch(/CommandPalette/);
    });
  }
});
