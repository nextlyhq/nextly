/**
 * Sample written emails, for screenshots in real mail clients.
 *
 * Skipped unless asked for. Each sample (one email per block, and one with
 * every block) is rendered exactly as a send renders it: inside core's
 * default layout with the starting brand settings. Light and dark are the
 * reading client's own setting, so the same emails serve both.
 *
 *   WRITTEN_SAMPLES_DIR=<dir>   writes <name>.html and <name>.txt there
 *   WRITTEN_SAMPLES_TO=<address> SMTP_URL=smtps://user:pass@host:465
 *                               mails each sample to that address
 *   SMTP_FROM="Name <a@b.c>"    optional sender (defaults to the SMTP user)
 *
 * From packages/nextly:
 *   WRITTEN_SAMPLES_DIR=./written-samples npx vitest run src/domains/email/__tests__/written-samples.send.test.ts
 *
 * The samples carry sample data only, so they are safe to send to a shared
 * inbox.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STARTING_BRAND } from "../brand-settings";
import {
  renderTemplate,
  type RenderedTemplate,
} from "../services/render-template";
import { defaultLayoutTemplate } from "../services/templates";
import type { WrittenBlock } from "../written/document";
import { WRITTEN_SAMPLE_DATA, WRITTEN_SAMPLES } from "../written/samples";

const DIR = process.env.WRITTEN_SAMPLES_DIR;
const TO = process.env.WRITTEN_SAMPLES_TO;
const SMTP_URL = process.env.SMTP_URL;

function render(blocks: WrittenBlock[]): RenderedTemplate {
  return renderTemplate(
    {
      subject: "Written email sample",
      htmlContent: "",
      plainTextContent: null,
      preheader: null,
      useLayout: true,
      kind: "template",
      format: "written",
      blocks: { version: 1, blocks },
    },
    defaultLayoutTemplate,
    { appName: "Nextly samples", year: "2026", ...WRITTEN_SAMPLE_DATA },
    { appName: "Nextly samples", brand: { ...STARTING_BRAND, footerLinks: [] } }
  );
}

const samples: Array<[string, WrittenBlock[]]> = [
  ...Object.entries(WRITTEN_SAMPLES).map(
    ([name, block]) => [name, [block]] as [string, WrittenBlock[]]
  ),
  ["everything", Object.values(WRITTEN_SAMPLES)],
];

describe.skipIf(!DIR && !TO)("written email samples", () => {
  it("writes or mails one email per block, and one with every block", async () => {
    if (DIR) {
      mkdirSync(DIR, { recursive: true });
      for (const [name, blocks] of samples) {
        const out = render(blocks);
        writeFileSync(join(DIR, `${name}.html`), out.html);
        writeFileSync(join(DIR, `${name}.txt`), out.text);
      }
    }
    if (TO) {
      expect(SMTP_URL, "set SMTP_URL to send the samples").toBeTruthy();
      const { createTransport } = await import("nodemailer");
      const transport = createTransport(SMTP_URL);
      for (const [name, blocks] of samples) {
        const out = render(blocks);
        await transport.sendMail({
          from: process.env.SMTP_FROM,
          to: TO,
          subject: `Written email sample: ${name}`,
          html: out.html,
          text: out.text,
        });
      }
    }
  }, 120_000);
});
