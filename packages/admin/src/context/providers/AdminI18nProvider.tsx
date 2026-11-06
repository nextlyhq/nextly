"use client";

/**
 * The interface language's catalogs for the admin: its own, with every
 * installed plugin's merged in from the admin metadata.
 *
 * Inside the branding provider because the plugins' catalogs arrive with the
 * signed-in admin metadata it reads. Before they arrive, and on the sign-in
 * screen, the admin's own strings are all there is, which is what they are.
 *
 * The language is the signed-in person's own choice, then the browser's, then
 * English. It is asked for only on a private screen whose session is known to
 * be signed in: the shared session query the private-route guard reads, so a
 * signed-out visitor opening a private address, while the guard decides where
 * to send them, asks nothing of `/me`. Until then, and on the signed-out
 * screens, the browser's language is used. Kept
 * apart from the language content is edited in, which the editor holds.
 *
 * @module context/providers/AdminI18nProvider
 */
import { useMemo, type ReactNode } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useAuthSession } from "@admin/hooks/queries/useAuthSession";
import { useStoredInterfaceLanguage } from "@admin/hooks/useInterfaceLanguage";
import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { mergeCatalogs } from "@admin/lib/i18n/merge-catalogs";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

export function AdminI18nProvider({
  children,
  signedIn = false,
}: {
  children: ReactNode;
  /** Whether this is a private screen, where a signed-in person's choice may be read. */
  signedIn?: boolean;
}): ReactNode {
  const { plugins } = useBranding();
  const session = useAuthSession();
  const stored = useStoredInterfaceLanguage(
    signedIn && session.data?.isAuthenticated === true
  );
  const catalogs = useMemo(
    () => mergeCatalogs(BUILT_IN_CATALOGS, plugins ?? []),
    [plugins]
  );
  return (
    <I18nProvider catalogs={catalogs} interfaceLanguage={stored ?? undefined}>
      {children}
    </I18nProvider>
  );
}
