# Singles

Code-first singles (formerly "globals"). Each single is defined via
`defineSingle({ ... })` from `nextly/config` and wired into the root
`nextly.config.ts` as part of the `singles: [...]` array.

A single is a one-of content record — Site Settings, Homepage layout,
Footer config, etc. Use Singles when there is exactly one record of a
given type, and use Collections when the type has many records.

Conventions:

- One file or folder per single. Folder if the single has hooks or
  helpers; flat file if it's a small scalar definition.
- Imports inside single files use relative paths (`../access/...`)
  rather than the `@/` alias because `nextly.config.ts` is loaded by
  the CLI through plain Node.js module resolution.

Skip this folder if you're using the Visual Schema Builder.
