/**
 * Zod, as the copy Nextly itself depends on: the `nextly/zod` entry.
 *
 * `nextly generate:types` writes Zod schemas into the app, and they import `z`
 * from here. An app depends on `nextly` but need not depend on `zod`, and under
 * pnpm or Yarn Plug'n'Play a bare `zod` import resolves only for a package that
 * declares it, so the schemas reach Zod through Nextly instead.
 *
 * Code that combines those schemas with its own should import `z` from here too,
 * so both use one Zod instance.
 *
 * Stable: this entry is part of the published surface, and re-exports `z` for
 * as long as generated schemas import it.
 */
export { z } from "zod";
