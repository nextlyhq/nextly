"use client";

/**
 * The admin's Fonts page, at Page Builder → Fonts: the one Fonts screen the
 * builder opens over its Design panel, on a page of its own, for a site admin
 * who never opens the builder.
 *
 * It reads and writes through the same site-style client the editor does
 * (`useSiteStyle`, and the writers `SiteFontsScreen` owns), so a font added
 * here is in every font picker of the builder, and one added there is listed
 * here. The page is registered for those who may change the site's design
 * (`update-site-style`), the same permission every font route asks.
 *
 * @module admin/fonts/FontsPage
 */
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";
import { useId, useMemo, type JSX } from "react";

import { readSiteStyleRecord } from "../../site-style-record";
import { SiteFontsScreen } from "../editor/site-style-fonts";
import { offerableFaces, renderedTokens } from "../editor/site-style-studios";
import { PLUGIN_SOURCE } from "../editor/stored-document";
import { PageBuilderBreadcrumb } from "../page-breadcrumb";
import { useSiteStyle } from "../site-style-client";

/** The page's name, its heading and its breadcrumb's last step. */
const FONTS_PAGE_NAME = "Fonts";

/**
 * Page Builder → Fonts.
 *
 * @returns The page
 */
export function FontsPage(): JSX.Element {
  const heading = useId();
  const config = usePluginClientConfig(PLUGIN_SOURCE);
  // The host's code-stated tier, under the stored one, as the editor reads
  // it: the faces the site's code supplies are listed and cannot be removed.
  const configSiteStyle = useMemo(
    () => readSiteStyleRecord(config?.siteStyle),
    [config]
  );
  const read = useSiteStyle(configSiteStyle);
  return (
    <div className="min-h-[calc(100vh-4rem)] w-full max-w-full px-4 py-6 @sm/content:px-6 @sm/content:py-8 @2xl/content:px-8">
      <PageBuilderBreadcrumb page={FONTS_PAGE_NAME} />
      <div className="mb-6">
        <h1 id={heading} className="text-xl font-semibold tracking-tight">
          {FONTS_PAGE_NAME}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The fonts your pages can use. The same screen opens in the builder
          from Design → Type, “Manage fonts…”.
        </p>
      </div>
      {/* The builder's own tokens, so the screen draws as it does there. */}
      <div className="nx-builder-tokens nx-fonts-page">
        <SiteFontsScreen
          labelledBy={heading}
          faces={offerableFaces(read.siteStyle, read.pending, read.error)}
          codeFaces={configSiteStyle.fonts}
          tokens={renderedTokens(read.siteStyle, read.pending, read.error)}
          absence={read.error !== null ? "failed" : "pending"}
          storedFaces={read.stored?.fonts}
          storedPending={read.pending}
          unreadableFonts={read.unreadableFonts}
        />
      </div>
    </div>
  );
}
