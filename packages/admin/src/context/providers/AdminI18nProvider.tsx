"use client";

/**
 * The interface language's catalogs for the admin: its own, with every
 * installed plugin's merged in from the admin metadata.
 *
 * Inside the branding provider because the plugins' catalogs arrive with the
 * signed-in admin metadata it reads. Before they arrive, and on the sign-in
 * screen, the admin's own strings are all there is, which is what they are.
 *
 * @module context/providers/AdminI18nProvider
 */
import { useMemo, type ReactNode } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { mergeCatalogs } from "@admin/lib/i18n/merge-catalogs";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

export function AdminI18nProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { plugins } = useBranding();
  const catalogs = useMemo(
    () => mergeCatalogs(BUILT_IN_CATALOGS, plugins ?? []),
    [plugins]
  );
  return <I18nProvider catalogs={catalogs}>{children}</I18nProvider>;
}
