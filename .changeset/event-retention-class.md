---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Record which retention window governs each captured event, and shorten the audit
window to 90 days.

The event table has carried a `retention_class` column since the outbox shipped,
but nothing ever wrote anything but `webhook`, so every row was measured against
the short outbox-hygiene window. The class now follows from why the row was
recorded: a row admitted by the audit seam is audit-class and outlives outbox
hygiene, while one admitted only because an endpoint exists stays webhook-class.
A row that is both takes the longer window, since evicting it on the delivery
clock would lose history nothing can reconstruct.

The audit window default moves from 365 days to 90. The previous value was
justified as "SOC 2 practice is a one-year floor", which does not hold up:
neither SOC 2 nor ISO 27001 A.8.15 mandates a period — both require only that
retention be defined and risk-based — and the twelve-month figure is PCI DSS
convention that has spread into the wider discourse. 90 days is where comparable
products land for content activity. A deployment genuinely in PCI scope should
raise `auditEventsMaxAgeMs`, which is a decision only the operator can make.

No behaviour changes for an existing deployment: the audit seam is off unless
`webhookAuditEnabled` is set, so rows continue to be recorded webhook-class and
pruned on the same schedule as before.
