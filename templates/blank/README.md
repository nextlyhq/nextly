# Blank template

A minimal Nextly project with the conventional folder layout already
scaffolded. Empty `nextly.config.ts`, no collections, one landing
page, and READMEs in every convention folder so you know where things
go as you grow.

## When to use

Choose `blank` when you want to build everything from scratch but
appreciate having the right folder structure waiting for you. Pick
[`blog`](../blog/README.md) instead if you want a populated example
with collections, singles, frontend pages, RSS, search, and demo
content already wired up.

## Scaffold

```bash
pnpm create nextly-app@alpha my-app --template blank
```

## What you get

```
my-app/
├── nextly.config.ts        # Empty config — add your collections / singles
├── .env.example            # NEXT_PUBLIC_SITE_URL etc.
├── next.config.ts          # (inherited from base)
├── postcss.config.mjs      # (inherited from base)
├── tsconfig.json           # (inherited from base)
└── src/
    ├── access/             # RBAC functions (anyone, authenticated, ...)
    ├── collections/        # defineCollection() definitions
    ├── singles/            # defineSingle() definitions
    ├── components/         # React components (ThemeToggle ships as an example)
    ├── lib/                # Project-wide helpers
    └── app/
        ├── layout.tsx      # Root layout (font + metadata)
        ├── globals.css     # Design tokens
        └── (frontend)/     # Public-facing routes (route group)
            └── page.tsx    # Landing page — flips between "Set up admin" / "Open admin"
```

The `(frontend)` route group keeps your public pages cleanly separated
from `app/admin/...` and `app/api/...` routes that Nextly mounts. As
you add routes, drop them inside `(frontend)/` and they'll inherit
your blog/marketing layout instead of the admin's.

Every convention folder ships with a `README.md` explaining what
belongs there. Replace them with real code as you build.

## Next steps

- **Add a collection** — create `src/collections/Posts.ts`, register
  it in `nextly.config.ts`, run `pnpm dev`. The admin will surface it
  immediately.
- **Add a public page** — drop a new file under
  `src/app/(frontend)/blog/page.tsx`. It'll be live at `/blog`.
- **Configure storage / email** — see
  [`nextlyhq.com/docs`](https://nextlyhq.com/docs) for adapter setup.

See [`templates/blog/README.md`](../blog/README.md) for a fully
populated example showing all of the above wired up.
