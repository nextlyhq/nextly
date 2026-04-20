# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately using one of these channels:

1. **GitHub Security Advisories (preferred)** — https://github.com/revnix/nextly-dev/security/advisories/new
2. **Email** — security@revnix.com

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (or a proof-of-concept)
- The affected package(s) and version(s)
- Any known mitigations

## What to expect

| Stage           | Target                                        |
| --------------- | --------------------------------------------- |
| Acknowledgement | Within **72 hours** of your report            |
| Initial triage  | Within **7 days**                             |
| Fix released    | Within **90 days** for high/critical severity |

We will keep you informed throughout the process and credit you in the advisory unless you prefer to remain anonymous.

## Supported versions

Only the latest minor version of each `@revnixhq/*` package receives security fixes. Older versions are unsupported.

## Scope

In scope:

- `@revnixhq/nextly` and all other `@revnixhq/*` packages in this repository
- Documentation code samples that imply a security guarantee

Out of scope:

- Third-party dependencies (report upstream; we will update once fixed)
- Issues in example apps under `apps/playground`
- Missing security headers on non-production documentation sites
