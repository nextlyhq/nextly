/**
 * Nextly Configuration
 *
 * @see https://nextlyhq.com/docs/configuration
 */

import { defineConfig } from "@revnixhq/nextly/config";
import { formBuilder } from "@revnixhq/plugin-form-builder";
import { vercelBlobStorage } from "@revnixhq/storage-vercel-blob";

import ContentSettings from "./src/app/singles/content-settings";

// Initialize Form Builder plugin
const formBuilderPlugin = formBuilder();

export default defineConfig({
  admin: {
    branding: {
      // Theme-aware defaults (fall back automatically when no custom logo is configured)
      logoUrlLight: "/Nextly_Icon_dark.svg",
      logoUrlDark: "/Nextly_Icon_Light.svg",
      logoText: "Nextly App",
    },
    pluginOverrides: {
      "revnixhq-plugin-form-builder": {
        placement: "standalone",
        after: "settings",
        appearance: { icon: "PieChart" },
      },
    },
  },
  // Include form builder collections so CLI can sync them to database
  collections: [...formBuilderPlugin.collections],
  singles: [ContentSettings],
  plugins: [formBuilderPlugin.plugin],

  // Storage: Vercel Blob (configured via BLOB_READ_WRITE_TOKEN env var)
  storage: process.env.BLOB_READ_WRITE_TOKEN
    ? [
        vercelBlobStorage({
          token: process.env.BLOB_READ_WRITE_TOKEN,
          collections: { media: true },
        }),
      ]
    : [],

  // Email: use Resend when RESEND_API_KEY is set, otherwise fall back to SMTP.
  // The DB-configured default provider (set via Admin UI) always takes priority
  // over this code-first fallback.
  email: process.env.RESEND_API_KEY
    ? {
        providerConfig: {
          provider: "resend" as const,
          apiKey: process.env.RESEND_API_KEY,
        },
        from: process.env.SMTP_FROM || "onboarding@resend.dev",
      }
    : {
        providerConfig: {
          provider: "smtp" as const,
          host: process.env.SMTP_HOST!,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: false,
          auth: {
            user: process.env.SMTP_USER!,
            pass: process.env.SMTP_PASS!,
          },
        },
        from: process.env.SMTP_FROM || "test.revnix@gmail.com",
      },

  typescript: {
    outputFile: "./src/types/nextly-types.ts",
  },

  db: {
    schemasDir: "./src/db/schemas/collections",
    migrationsDir: "./src/db/migrations",
  },
});
