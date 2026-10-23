"use client";

import { Button } from "@nextlyhq/ui";
import { useState } from "react";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Minus,
} from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import type { BrandReach } from "@admin/services/emailBrandApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { groupByOwner } from "../messages/messages-model";
import { editRouteFor } from "../useTemplateActions";

import { namesLine, plural, unreachedReason } from "./design-model";

/** An email's name, a link to it where the reader may open it. */
function EmailLink({
  email,
  canOpen,
}: {
  email: EmailTemplateRecord;
  canOpen: boolean;
}) {
  if (!canOpen) return <span>{email.name}</span>;
  return (
    <Link href={editRouteFor(email)} className="hover:underline">
      {email.name}
    </Link>
  );
}

/** Emails grouped under their owners, each a link. */
export function EmailsByOwner({
  emails,
  canOpen,
}: {
  emails: EmailTemplateRecord[];
  canOpen: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groupByOwner(emails).map(({ group, rows }) => (
        <div key={group.key} className="min-w-0 space-y-1">
          <div className="text-xs text-muted-foreground">
            {group.label} · {rows.length}
          </div>
          <ul className="space-y-1 text-sm">
            {rows.map(email => (
              <li key={email.id}>
                <EmailLink email={email} canOpen={canOpen} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Reached({
  emails,
  canOpen,
}: {
  emails: EmailTemplateRecord[];
  canOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Reaches {plural(emails.length, "email")} that use the Default layout
      </div>
      {emails.length > 0 &&
        (open ? (
          <EmailsByOwner emails={emails} canOpen={canOpen} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {namesLine(emails.map(email => email.name))}.
          </p>
        ))}
      {emails.length > 3 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show fewer" : `Show all ${emails.length}`}
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}

function NotReached({
  entries,
  canOpen,
}: {
  entries: Array<{ entry: BrandReach; email: EmailTemplateRecord }>;
  canOpen: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Minus className="h-4 w-4 shrink-0" />
        Doesn&apos;t reach
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every email uses the Default layout.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map(({ entry, email }) => (
            <li key={entry.templateId} className="text-sm">
              <div className="font-medium">
                <EmailLink email={email} canOpen={canOpen} />
              </div>
              <div className="text-xs text-muted-foreground">
                {unreachedReason(entry)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Which emails the brand settings reach, and which they don't and why. Any
 * layout can still read the settings as variables.
 */
export function BrandReachCard({
  reach,
  emails,
  canOpen,
}: {
  reach: BrandReach[];
  emails: EmailTemplateRecord[];
  canOpen: boolean;
}) {
  const byId = new Map(emails.map(email => [email.id, email]));
  const known = reach.flatMap(entry => {
    const email = byId.get(entry.templateId);
    return email ? [{ entry, email }] : [];
  });
  const reached = known.filter(({ entry }) => entry.reached);
  const notReached = known.filter(({ entry }) => !entry.reached);
  return (
    <section
      aria-labelledby="brand-reach-heading"
      className="rounded-lg border border-border bg-card"
    >
      <div className="border-b border-border p-4">
        <h2 id="brand-reach-heading" className="text-base font-semibold">
          Where the brand settings reach
        </h2>
        <p className="text-sm text-muted-foreground">
          Layouts other than the Default layout keep their own look. Any layout
          can still read the settings as variables, such as{" "}
          <code className="font-mono text-xs">{"{{ brand.accentColor }}"}</code>
          .
        </p>
      </div>
      <div className="grid divide-y divide-border md:grid-cols-[2fr_1fr] md:divide-x md:divide-y-0">
        <Reached emails={reached.map(({ email }) => email)} canOpen={canOpen} />
        <NotReached entries={notReached} canOpen={canOpen} />
      </div>
    </section>
  );
}
