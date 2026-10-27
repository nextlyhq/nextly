"use client";

import type { JSX } from "react";

import { Lock } from "@admin/components/icons";
import { StatusPage } from "@admin/components/shared/status-page";
import type { AccessSubject } from "@admin/types/access-subject";

const SUBJECT_NOUN: Record<AccessSubject, string> = {
  collection: "this collection",
  single: "this Single",
};

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
  const noun = subject ? SUBJECT_NOUN[subject] : "this page";
  return (
    <StatusPage
      visual={
        // The lock the document-lock banner uses, so "you can't do this
        // here" has one mark across the admin.
        <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Lock className="h-9 w-9" aria-hidden="true" />
        </div>
      }
      label="No access"
      title={`You don't have access to ${noun}`}
      description="Your account doesn't have permission to open it. If you need it, ask an admin."
    />
  );
}
