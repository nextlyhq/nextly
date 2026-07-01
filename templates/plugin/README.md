# {{pluginName}}

A [Nextly](https://nextlyhq.com) plugin.

## Develop

```bash
pnpm install
pnpm dev      # runs the embedded /dev playground → open http://localhost:3000/admin
```

Your plugin lives in `src/`. The `dev/` folder is a minimal Nextly app on SQLite
that registers this plugin so you can exercise it in a real admin with hot-reload.
Editing files under `src/` reloads the playground. **`dev/` is never published.**

## Test

```bash
pnpm test     # boots a real Nextly on in-memory SQLite via createTestNextly
```

## Build & publish

```bash
pnpm build    # tsup → dist/
npm publish
```

Only `dist/` ships (see `files` in `package.json`). The `nextly-plugin` keyword
makes this package discoverable.

## Use in an app

```ts
// nextly.config.ts
import { defineConfig } from "nextly";
import { myPlugin } from "{{pluginName}}";

export default defineConfig({
  plugins: [myPlugin()],
});
```

See the [Nextly plugin author guide](https://nextlyhq.com/docs/plugins/author-guide).
