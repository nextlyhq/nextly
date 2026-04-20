# create-nextly-app

CLI to scaffold a new Nextly CMS project or add Nextly to an existing Next.js app.

## Quick Start

```bash
npx @revnixhq/create-nextly-app my-blog
```

The CLI walks you through template selection, schema approach, and database setup interactively.

## Templates

| Template  | Description                                                                                   |
| --------- | --------------------------------------------------------------------------------------------- |
| **Blank** | Empty config. Define your own schemas from scratch.                                           |
| **Blog**  | Posts, authors, categories, site settings. Includes frontend pages and optional demo content. |

More templates (website, portfolio, e-commerce) are planned for future releases.

### Blog Template

The blog template includes:

- **Collections**: Posts (with rich text, featured images, author/category relationships), Authors, Categories
- **Singles**: Site Settings (site name, tagline, social links)
- **Frontend pages**: Homepage, blog listing with pagination, single post, author profile, category archive
- **Components**: Header, Footer, PostCard, PostGrid, Pagination, AuthorCard, CategoryBadge, RichTextRenderer
- **Seed data** (optional): 5 sample posts, 2 authors, 3 categories with placeholder images

All frontend pages use Server Components with Nextly's Direct API for zero-overhead data fetching.

## Schema Approaches

When selecting a content template (like Blog), you choose how to define your schemas:

| Approach       | Description                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| **Code-first** | Full schema definitions in `nextly.config.ts`. Type-safe, version-controlled. Like Payload CMS. |
| **Visual**     | Empty config. Schemas created via the Admin Panel UI. Like Strapi/WordPress.                    |
| **Both**       | Core schemas in code, extend with additional collections via the Admin Panel.                   |

## Usage

### Interactive (recommended)

```bash
npx @revnixhq/create-nextly-app my-project
```

### With flags (non-interactive)

```bash
# Blog with code-first approach and demo content
npx @revnixhq/create-nextly-app my-blog \
  --template blog \
  --approach code-first \
  --demo-data \
  --database sqlite

# Blank project with PostgreSQL
npx @revnixhq/create-nextly-app my-app \
  --template blank \
  --database postgresql

# Quick setup with all defaults (blank + SQLite)
npx @revnixhq/create-nextly-app my-app -y
```

### CLI Flags

| Flag                      | Short | Description                                | Default            |
| ------------------------- | ----- | ------------------------------------------ | ------------------ |
| `--template <name>`       | `-t`  | Template to use (blank, blog)              | Interactive prompt |
| `--approach <type>`       | `-a`  | Schema approach (code-first, visual, both) | Interactive prompt |
| `--demo-data`             |       | Include demo content                       | Interactive prompt |
| `--database <db>`         | `-d`  | Database (sqlite, postgresql, mysql)       | Interactive prompt |
| `--yes`                   | `-y`  | Skip prompts, use defaults                 |                    |
| `--branch <branch>`       | `-b`  | Git branch for template download           | main               |
| `--local-template <path>` |       | Local templates directory (dev only)       |                    |
| `--skip-install`          |       | Skip dependency installation               |                    |
| `--use-yalc`              |       | Use yalc for local packages (dev only)     |                    |

## How Templates Work

Templates are stored in the `/templates/` directory at the monorepo root (not bundled in this package). When you run the CLI:

1. Templates are downloaded from GitHub at runtime (like Payload CMS's create-payload-app)
2. The base template provides shared foundation (admin routes, API handlers, styles)
3. The selected template overlays its files on top (frontend pages, components, config)
4. Approach-specific config is copied based on your selection
5. Seed files are included when demo data is selected

For local development, use `--local-template` to read from the filesystem instead of downloading.

## After Scaffolding

```bash
cd my-blog
pnpm dev
```

On first run, Nextly will:

- Create database tables
- Sync collections from your config
- Seed demo content (if selected)
- Generate TypeScript types

Visit `http://localhost:3000` to see your site and `http://localhost:3000/admin/setup` to create your admin account.

## Requirements

- Node.js 18+
- Next.js 14+ with App Router

## License

MIT
