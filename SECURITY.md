# Security Policy

Thank you for taking the time to disclose a security issue responsibly. This document describes how to report, what to expect, and what's in scope.

## Reporting a vulnerability

**Do not** open a public GitHub issue, pull request, or community-channel post for security reports.

### Primary channel — GitHub Private Vulnerability Reporting (preferred)

The Nextly repository has Private Vulnerability Reporting enabled. To submit a report:

1. Visit the repository's **Security** tab.
2. Click **"Report a vulnerability"** (or open the form directly: <https://github.com/nextlyhq/nextly/security/advisories/new>).
3. Fill in the title, description, affected component(s), reproduction steps, and severity assessment.

The report is visible only to repository administrators and the reporter. Discussion, drafting the advisory, and coordinating disclosure all happen inside that private thread.

### Backup channel — email

If you do not have a GitHub account, send the report to <security@nextlyhq.com>. Backup-channel reports may be slower to triage than the GitHub flow.

We do not accept reports via Discord / Slack / Twitter DMs.

## What to include

- Affected package(s) (`@revnixhq/nextly`, `@revnixhq/admin`, `@revnixhq/storage-s3`, etc.) and version(s).
- A clear description of the issue and the security impact.
- Reproduction steps, including a minimal proof-of-concept where practical.
- Suggested mitigation, if you have one.
- Whether you'd like credit (and how) in the published advisory.

## Response SLA

These are best-effort targets, not contractual:

- **Acknowledge** within **48 hours** of receipt.
- **Critical** patched within **7 days**.
- **High** patched within **14 days**.
- **Medium** / **Low** patched within **30 days**.

Status updates are posted in the private thread until disclosure.

## Severity matrix

| Severity     | Examples                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Remote code execution, authentication bypass, unauthenticated data exfiltration, supply-chain compromise.                                                                 |
| **High**     | Privilege escalation, authenticated data exposure, persistent XSS in the admin UI, server-side request forgery (SSRF) reaching internal infrastructure or cloud-metadata. |
| **Medium**   | Information disclosure, denial of service against a single tenant, reflected XSS, CSRF on non-state-changing endpoints, weak crypto defaults.                             |
| **Low**      | Missing security headers, weak defaults that require active misuse, defense-in-depth gaps.                                                                                |

## Scope

**In scope:** all packages under `packages/*` of this monorepo. Currently supported: the **`0.x`** series (beta).

**Out of scope:**

- Vulnerabilities in transitive dependencies that have no proven additional impact via Nextly's surface — please report those upstream first.
- Versions older than the current `0.x` minor.
- Intentional misconfiguration (e.g. setting `security.trustProxy: true` without an `TRUSTED_PROXY_IPS` allowlist).
- Social engineering and phishing of maintainers.
- Denial of service via legitimate-but-expensive operations whose cost is bounded by configurable limits.
- Self-XSS and other issues requiring the victim to paste attacker-controlled content into their own admin session.

## Disclosure timeline

- **90-day standard embargo** from acknowledgement to public advisory.
- Embargo is extendable by mutual agreement when a fix is complex or coordinated with other parties.
- Once a fix ships in a tagged release, the GitHub Security Advisory and an associated CVE (where applicable) are published together. The reporter is credited unless they opt out.

## Credit

Reporters are credited in the GitHub Security Advisory and the published CVE record. We do not run a paid bug bounty program. We ask reporters not to publicly disclose the issue, exploit it against any production system, or share details outside the private thread until the advisory is published.

## What we will not do

- Accept reports via public issues, pull requests, Discord / Slack / Twitter DMs.
- Pay for reports.
- Negotiate non-disclosure agreements outside the standard embargo timeline.
- Process reports for unsupported versions.

If you're unsure whether something qualifies, file it through the GitHub flow anyway — we'd rather review and triage out-of-scope reports than miss a real one.
