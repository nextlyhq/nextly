---
"@revnixhq/create-nextly-app": minor
"@nextly/telemetry": patch
---

`create-nextly-app` cleanup:

- **Detect package manager via `npm_config_user_agent`.** Fresh scaffolds previously fell back to `"npm"` no matter how the CLI was invoked, so the final "next steps" output always printed `npm run dev`. Now `pnpm create nextly-app` prints `pnpm dev`, `yarn create nextly-app` prints `yarn dev`, etc. Lockfile detection remains as a fallback for direct-bin invocations.
- **Drop the "Include demo content?" prompt and `--demo-data` flag.** Seeding is now triggered from the admin dashboard's `SeedDemoContentCard` after `/admin/setup`, so the CLI no longer asks. The prompt + flag have been removed; existing scripts that pass `--demo-data` will see Commander reject the unknown option (intentional break — alpha).
- **Drop the "Both" schema-approach option.** Two approaches now: code-first and visual schema builder. They aren't mutually exclusive — a code-first project can add UI-defined collections later via the visual builder, and vice versa — so the "Both" choice was redundant. After picking one, the CLI prints a one-line tip pointing at the other approach for later use.
