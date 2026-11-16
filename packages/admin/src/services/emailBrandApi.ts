/**
 * Email brand settings: the look of every email that uses the Default layout.
 *
 * The settings, where they started, the email-safe fonts, and which emails
 * they reach come from one read; a save takes any of the settings and returns
 * them as stored.
 *
 * @module services/emailBrandApi
 */

import type { DraftPreviewRequest } from "nextly/api/email-template-preview-types";

import { fetcher } from "../lib/api/fetcher";
import type { MutationResponse } from "../lib/api/response-types";

/**
 * A change to the settings: any of them, or null to return one to its start.
 * The server's own schema type, by way of the draft preview that carries one,
 * so a rule changed there is a compile error here.
 */
export type BrandSettingsChange = NonNullable<DraftPreviewRequest["brand"]>;

/** A font on the email-safe list. */
export type EmailSafeFontKey = NonNullable<BrandSettingsChange["fontFamily"]>;

/** A link under an email's footer. */
export interface BrandLink {
  label: string;
  url: string;
}

/** The brand settings, as the server resolves them. */
export interface BrandSettings {
  /** An absolute http(s) address, or null for no logo. */
  logoUrl: string | null;
  /** In pixels. */
  logoWidth: number;
  accentColor: string;
  backgroundColor: string;
  contentColor: string;
  fontFamily: EmailSafeFontKey;
  /** Null for the standard line; empty for none. */
  footerText: string | null;
  footerLinks: BrandLink[];
}

/** One of the fonts nearly every email client has. */
export interface BrandFont {
  key: EmailSafeFontKey;
  label: string;
  stack: string;
}

/** Why the settings don't reach an email. */
export type BrandReachReason =
  | "setInCode"
  | "inactive"
  | "noLayout"
  | "layoutWithoutBrand";

/** Whether the settings reach one email, and through what. */
export interface BrandReach {
  templateId: string;
  slug: string;
  name: string;
  reached: boolean;
  reason: BrandReachReason | null;
  via: { body: boolean; layout: boolean };
  layout: {
    id: string;
    slug: string;
    name: string;
    overridden: boolean;
  } | null;
}

export interface BrandOverview {
  settings: BrandSettings;
  /** Where each setting starts, and returns to when it is cleared. */
  starting: BrandSettings;
  fonts: BrandFont[];
  reach: BrandReach[];
}

export async function getBrand(): Promise<BrandOverview> {
  return fetcher<BrandOverview>("/email-templates/brand", {}, true);
}

export async function updateBrand(
  change: BrandSettingsChange
): Promise<BrandSettings> {
  const result = await fetcher<MutationResponse<BrandSettings>>(
    "/email-templates/brand",
    { method: "PATCH", body: JSON.stringify(change) },
    true
  );
  return result.item;
}
