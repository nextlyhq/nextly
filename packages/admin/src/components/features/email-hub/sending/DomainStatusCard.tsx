"use client";

import { Badge, Button } from "@nextlyhq/ui";
import { type JSX, useState } from "react";

import { Check, Copy } from "@admin/components/icons";
import type { EmailDomainStatus } from "@admin/services/emailProviderApi";

const STATUS_LABEL: Record<EmailDomainStatus["status"], string> = {
  verified: "Verified",
  pending: "Pending",
  failed: "Failed",
};

const STATUS_VARIANT: Record<
  EmailDomainStatus["status"],
  "success" | "warning" | "destructive"
> = {
  verified: "success",
  pending: "warning",
  failed: "destructive",
};

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

/**
 * The sending domain's status as the provider reports it, with the DNS
 * records the provider expects, each copyable. Shown only where the provider
 * reports one; the hub never changes DNS itself.
 */
export function DomainStatusCard({
  status,
}: {
  status: EmailDomainStatus;
}): JSX.Element {
  return (
    <section
      aria-labelledby="sending-domain-heading"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="sending-domain-heading" className="text-base font-semibold">
          Sending domain
        </h2>
        <span className="font-mono text-sm">{status.domain}</span>
        <Badge variant={STATUS_VARIANT[status.status]}>
          {STATUS_LABEL[status.status]}
        </Badge>
      </div>
      {status.status !== "verified" && (
        <p className="text-sm text-muted-foreground">
          Add these records at your domain&apos;s DNS host. The provider checks
          them on its own schedule.
        </p>
      )}
      {status.records.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {status.records.map(record => (
            <li
              key={`${record.type}:${record.name}`}
              className="grid gap-1 p-3 text-sm sm:grid-cols-[4rem_1fr_auto] sm:items-center"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {record.type}
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1">
                  <span className="break-all font-mono text-xs">
                    {record.name}
                  </span>
                  <CopyValue
                    value={record.name}
                    label={`${record.type} record name`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {record.value}
                  </span>
                  <CopyValue
                    value={record.value}
                    label={`${record.type} record value`}
                  />
                </div>
                {record.priority !== undefined && (
                  <div className="font-mono text-xs text-muted-foreground">
                    Priority {record.priority}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
