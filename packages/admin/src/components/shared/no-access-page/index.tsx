"use client";

import type { JSX } from "react";

import { Lock } from "@admin/components/icons";
import { StatusPage } from "@admin/components/shared/status-page";
import { useT } from "@admin/lib/i18n/I18nProvider";
import type { MessageKey } from "@admin/lib/i18n/translate";
import type { AccessSubject } from "@admin/types/access-subject";

// A whole title per subject rather than a noun spliced into one sentence, so
// a language can agree the rest of the sentence with the noun. Kept as the
// literal keys, which take no parameters, so `t(title)` needs none: typed as
// any key, the call would ask for the parameters some other key takes.
const SUBJECT_TITLE = {
  collection: "nextly.status.noAccess.title.collection",
  single: "nextly.status.noAccess.title.single",
} as const satisfies Record<AccessSubject, MessageKey>;

export interface NoAccessPageProps {
  /** What the refused route opens; absent for any other page. */
  subject?: AccessSubject;
}

/**
 * Shown in place of a page the user may not open.
 *
 * It names the kind of thing refused and never the role or the permission
 * behind it: a user can hold several roles, and a permission slug is an
 * internal spelling, so the sentence reads the same whatever the account
 * holds. It also says nothing about whether the collection or Single exists
 * beyond the address the user already typed.
 */
export function NoAccessPage({ subject }: NoAccessPageProps): JSX.Element {
  const t = useT();
  const title = subject
    ? SUBJECT_TITLE[subject]
    : "nextly.status.noAccess.title.page";
  return (
    <StatusPage
      visual={
        // The lock the document-lock banner uses, so "you can't do this
        // here" has one mark across the admin.
        <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Lock className="h-9 w-9" aria-hidden="true" />
        </div>
      }
      label={t("nextly.status.noAccess.label")}
      title={t(title)}
      description={t("nextly.status.noAccess.description")}
    />
  );
}
