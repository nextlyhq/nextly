"use client";

/**
 * The top of the Design panel's Type tab: the Body and Headings fonts, drawn
 * by the builder (`SiteFontRoles`) from the studio's variables, so a pick is
 * one variable edit the studio saves and undoes like any other, and from the
 * site's fonts the panel's Font controls read.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-font-roles-tab
 */
import { FontChoicesContext, SiteFontRoles } from "@nextlyhq/builder/shell";
import { useContext, type JSX } from "react";

import { useFontCatalogue } from "./site-style-fonts";
import { useVariablesStudio } from "./site-style-tokens-studio";

/** The Body and Headings fonts, inside the tokens studio's frame. */
export function FontRolesTab(): JSX.Element | null {
  const studio = useVariablesStudio();
  const fonts = useContext(FontChoicesContext);
  const catalogue = useFontCatalogue();
  if (studio?.tokens === undefined) return null;
  return (
    <SiteFontRoles
      tokens={studio.tokens}
      onChange={studio.onChange}
      readOnly={studio.readOnly ?? false}
      supplied={studio.supplied?.siteText}
      faces={fonts?.faces}
      fromCode={fonts?.fromCode ?? []}
      onManageFonts={fonts?.onManageFonts}
      onAddCut={catalogue?.add}
    />
  );
}
