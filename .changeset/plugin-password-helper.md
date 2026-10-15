---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Plugins can hash, verify and check passwords with core's helper, `ctx.security.passwords` (experimental, from `@nextlyhq/plugin-sdk`), for the people a plugin signs in itself.

The helper hashes every character of a password, NFC-normalised, with scrypt from `node:crypto` (N = 2^15, r = 8, p = 3: 32 MiB a hash), and writes a string of at most 255 ASCII characters that names its algorithm and setting, so `needsRehash` can move a stored hash to a later setting at the next sign-in. A password longer than 256 code points is refused with `PasswordTooLongError`, never cut. `verify` answers false without throwing for a hash it did not write, a staff bcrypt hash among them, and spends a real verification's time when given no hash at all.

`check` goes by length (a minimum of 8 to 64, default 8; a maximum of 64 to 256, default 128) and a shipped list of the 3,000 most common passwords, never by kinds of characters. With `breached: true` it also asks the site's breached-password source, set as `security.breachedPasswords` in `nextly.config.ts` (default: Have I Been Pwned's range service). Only a 20-bit prefix of the password's SHA-1 leaves the process, a range service is reached only over `https` and asked for padded answers, and a source that fails or is slow leaves the password unchecked. A non-https source is sent nothing, and boot warns about it. `SecurityConfigSchema` (`nextly/schemas`) accepts `breachedPasswords` too, so a configuration validated with it keeps its source.

The helper never uses an app's `passwordHasher`, and no staff path's hashing changes. A password that is not well-formed Unicode (a lone surrogate, as JSON can carry) is refused by `hash` and `check` and never verifies.

`PluginContext` gains a required member, `security`. A plugin receives its context from core and needs no change. Code that builds a `PluginContext` by hand, such as a test double, adds `security`; a context from `createTestNextly` (`@nextlyhq/plugin-sdk/testing`) already has it.
