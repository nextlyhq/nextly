# Playground

Internal development sandbox for working on Nextly. Used by maintainers to iterate on the runtime, admin panel, plugins, and adapters.

> This is not an example for end users. Use [`templates/blog`](../../templates/blog) for that.

## What this is

A pre-wired Nextly project with the admin panel mounted at `/admin`, the form builder plugin registered, and a database adapter selected via env vars. Edits to `packages/*` source files hot-reload here through workspace dependencies.

## Run it

```bash
cd apps/playground
cp .env.example .env   # copy and fill DATABASE_URL, BLOB_READ_WRITE_TOKEN, etc.
pnpm dev
```

Visit [`http://localhost:3000/admin/setup`](http://localhost:3000/admin/setup) to create the first admin user.

## Database configuration

Three minimal `.env.<dialect>` templates are provided for quick DB switching. Copy the one you want into `.env`:

- `.env.postgresql` for PostgreSQL
- `.env.mysql` for MySQL
- `.env.sqlite` for SQLite

`.env.example` carries the full reference of supported variables (storage tokens, email providers, telemetry overrides, etc.).

## What's wired up

- **Admin:** mounted at `app/admin/[[...params]]/page.tsx` via `<RootLayout />` from `@revnixhq/admin`
- **Plugins:** `@revnixhq/plugin-form-builder` registered with admin pluginOverrides
- **Storage:** `@revnixhq/storage-vercel-blob` (when `BLOB_READ_WRITE_TOKEN` is set)
- **Email:** Resend when `RESEND_API_KEY` is set, SMTP fallback otherwise

## License

[MIT](../../LICENSE.md)
