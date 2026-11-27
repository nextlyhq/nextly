import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCANNED,
  siteTemplateWordsIn,
  siteTemplateWordsInRepository,
} from "./check-words-site-template.mjs";

/**
 * "Site templates" names the ready-made whole-site designs a gallery will
 * offer, and no gallery exists yet; the installer's starts go by their own
 * names.
 * An email template a site owns is one of "your own templates", as against
 * "plugin templates". These tests keep the two apart in every place a person
 * or an agent reads: the docs, the admin, the installer and the email code,
 * comments and test names included.
 */

describe("the words 'site template'", () => {
  it("are used nowhere they are scanned", () => {
    expect(siteTemplateWordsInRepository()).toEqual([]);
  });

  it("scan the docs, release notes, the admin, the installer, core and the form builder", () => {
    expect(SCANNED).toEqual(
      expect.arrayContaining([
        "docs",
        ".changeset",
        "packages/admin/src",
        "packages/create-nextly-app/src",
        "packages/nextly/src",
        "packages/plugin-form-builder/src",
        "templates",
      ])
    );
  });

  it("are found by the repository walk, in every scanned folder", () => {
    // A repository of its own, so the walk itself is shown to read each
    // folder: a clean result from the real one says nothing on its own.
    const root = mkdtempSync(join(tmpdir(), "site-template-words-"));
    try {
      for (const folder of SCANNED) {
        mkdirSync(join(root, folder), { recursive: true });
        writeFileSync(join(root, folder, "page.md"), "Pick a site template.\n");
        writeFileSync(join(root, folder, "clean.ts"), 'const slug = "site-templates";\n');
      }
      expect(siteTemplateWordsInRepository(root)).toEqual(
        SCANNED.map(folder => `${folder}/page.md:1: Pick a site template.`)
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("are found in a comment, a test name and shown text", () => {
    // The spellings the email code used, each of which the check must report.
    const cases = [
      "// A site template a setting sends.",
      ' * known: may be sent from code". A site template with neither reads "Not sent',
      '  it("says a site template with no senders is not sent by anything yet", () => {',
      "<p>Site Templates</p>",
      // One word linked or styled renders the same words.
      "Choose a site [template](/docs/templates) to start from.",
      "Choose a site <em>template</em> to start from.",
      "Choose a [site](/docs/sites) template to start from.",
    ];
    for (const text of cases) {
      expect(siteTemplateWordsIn("fixture.ts", text)).toHaveLength(1);
    }
  });

  it("are found across a comment's line break, on the line they start", () => {
    const text = [
      "/**",
      " * A shop plugin: its settings send a site",
      " * template, as a form's notification rule does.",
      " */",
    ].join("\n");
    expect(siteTemplateWordsIn("fixture.ts", text)).toEqual([
      "fixture.ts:2: * A shop plugin: its settings send a site",
    ]);
  });

  it("leave code names and other words alone", () => {
    // A collection slug and its table, which a site may name as it likes, and
    // words that only contain the two.
    const text = [
      'slug: "site-templates",',
      'tableName: "dc_site_templates",',
      "a website template",
      "your own templates, as against plugin templates",
    ].join("\n");
    expect(siteTemplateWordsIn("fixture.ts", text)).toEqual([]);
  });
});
