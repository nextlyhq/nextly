# Nextly

An open-source CMS and app framework for Next.js. Define your content schema with Code-First configuration or the Visual Schema Builder, then consume it with a type-safe API.

## Packages

### Core 

| Package            | Description                                             |
| ------------------ | ------------------------------------------------------- |
| **nextly**         | Core CMS functionality - database, services, APIs, RBAC |
| **@nextly/admin**  | Admin dashboard and management interface                |
| **@nextly/client** | Client SDK for browser-based applications _(scaffold)_  |
| **@nextly/ui**     | Headless UI components for plugins _(scaffold)_         |

### Database Adapters

| Package                      | Description                     |
| ---------------------------- | ------------------------------- |
| **@nextly/adapter-postgres** | PostgreSQL adapter _(scaffold)_ |
| **@nextly/adapter-mysql**    | MySQL adapter _(scaffold)_      |
| **@nextly/adapter-sqlite**   | SQLite adapter _(scaffold)_     |

### Configuration

| Package                     | Description                     |
| --------------------------- | ------------------------------- |
| **@nextly/eslint-config**   | Shared ESLint configuration     |
| **@nextly/tsconfig**        | Shared TypeScript configuration |
| **@nextly/prettier-config** | Shared Prettier configuration   |

## Monorepo Structure

```
nextly-dev/
├── apps/
│   └── playground/           # Development/testing app
├── packages/
│   ├── nextly/               # Core CMS (nextly)
│   ├── create-nextly-app/    # CLI scaffold tool
│   ├── admin/                # Admin UI (@nextly/admin)
│   ├── client/               # Client SDK (@nextly/client)
│   ├── ui/                   # UI components (@nextly/ui)
│   ├── adapter-postgres/     # PostgreSQL adapter
│   ├── adapter-mysql/        # MySQL adapter
│   ├── adapter-sqlite/       # SQLite adapter
│   ├── eslint-config/        # ESLint config
│   ├── tsconfig/             # TypeScript config
│   └── prettier-config/      # Prettier config
├── templates/                # Project starter templates
│   ├── base/                 # Shared foundation (admin, API routes)
│   ├── blank/                # Empty starter
│   └── blog/                 # Blog with posts, authors, categories
├── scripts/                  # Monorepo scripts
└── docs/                     # Documentation
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+
- Docker Desktop (for local database)

### Quick Start (3 Steps)

1. **Clone and install dependencies:**

```sh
git clone https://github.com/nextlyhq/nextly.git
cd nextly
pnpm install
```

2. **Setup database:**

```sh
# Start PostgreSQL database
pnpm docker:up

# Copy environment variables and run migrations
cp .env.docker .env
cd packages/nextly
pnpm drizzle:migrate
pnpm db:seed:all
cd ../..
```

3. **Run the development server:**

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Docker Development Environment

Nextly uses Docker Compose to provide a consistent development environment across all platforms (macOS, Linux, Windows).

### Services

- **PostgreSQL 16**: Main database (`localhost:5432`)
- **Adminer**: Database management UI ([http://localhost:8080](http://localhost:8080))
- **Redis** (optional): Caching layer (`localhost:6379`)

### Quick Commands

```bash
# Start all services
pnpm docker:up

# Stop all services
pnpm docker:down

# View logs (all services or specific)
pnpm docker:logs
pnpm docker:logs postgres

# Open PostgreSQL shell
pnpm docker:shell

# Create database backup
pnpm docker:backup

# Restore from backup
pnpm docker:restore backups/backup-20250108-143022.sql

# Reset database (deletes all data!)
pnpm docker:reset

# Check service status
pnpm docker:status

# Restart services
pnpm docker:restart
```

### Database Connection

When using Docker, your application connects to:

```env
DATABASE_URL=postgresql://postgres:dev_password_change_in_production@localhost:5432/nextly_dev
```

**Adminer Access:**

- URL: http://localhost:8080
- System: PostgreSQL
- Server: `postgres`
- Username: `postgres`
- Password: `dev_password_change_in_production`
- Database: `nextly_dev`

### Database Migrations & Seeding

After starting Docker for the first time:

```bash
# 1. Update your .env file
cp .env.docker .env

# 2. Run migrations (from packages/nextly)
cd packages/nextly
pnpm drizzle:migrate

# 3. Seed initial data (RBAC permissions)
pnpm db:seed

# 4. Start development
cd ../..
pnpm dev
```

**Complete workflow guide:** Database integration documentation coming soon.

### Optional: Redis Cache

To start with Redis:

```bash
docker compose --profile with-redis up -d
```

### Troubleshooting

**Port already in use:**

```bash
# Check what's using port 5432
lsof -i :5432

# Change port in .env.docker
DB_PORT=5433
```

**Data persistence:**
Data is stored in Docker volumes and persists across restarts. Only `pnpm docker:reset` deletes data.

**Reset everything:**

```bash
pnpm docker:down
docker volume prune  # Remove all unused volumes
pnpm docker:up
```

---

## Common Scripts

Nextly uses consistent script naming across all packages. Run these commands from the root directory:

### Development

```bash
pnpm dev              # Start all packages in watch mode (sequential)
pnpm dev:parallel     # Start all packages in parallel
pnpm dev:core         # Start only nextly in watch mode
pnpm dev:admin        # Start only @nextly/admin in watch mode
pnpm dev:app          # Start only playground app (Next.js)
```

### Building

```bash
pnpm build            # Build all packages (uses Turbo cache)
```

### Code Quality

```bash
pnpm lint             # Lint all packages
pnpm lint:fix         # Auto-fix linting issues
pnpm check-types      # Type check all packages
pnpm format           # Format code with Prettier
```

### Testing

```bash
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm test:ui          # Open Vitest UI
pnpm test:coverage    # Generate coverage report
pnpm test:e2e         # Run Playwright E2E tests
pnpm test:e2e:ui      # Run E2E tests with Playwright UI
```

### Cleaning

```bash
pnpm clean            # Clean all dist/ folders
pnpm clean:cache      # Clear Turbo cache
pnpm clean:all        # Clean everything (dist + cache + tsbuildinfo)
pnpm fresh            # Nuclear option: clean all + reinstall + rebuild
```

**For detailed script conventions**, see each package's `package.json` file.

---

## Package Development

### Working on Core Package (nextly)

```bash
pnpm dev:core         # Watch mode for core package
pnpm --filter nextly test          # Run core tests
pnpm --filter nextly check-types   # Type check core
```

### Working on Admin Package (@nextly/admin)

```bash
pnpm dev:admin        # Watch mode for admin package
pnpm --filter @nextly/admin test   # Run admin tests
pnpm --filter @nextly/admin check-types  # Type check admin
```

### Working on Multiple Packages

```bash
pnpm dev:packages     # Watch mode for all @nextly/* packages
```

---

## Turborepo Task Configuration

Nextly uses [Turborepo](https://turbo.build) to orchestrate tasks across the monorepo. Tasks are configured in `turbo.jsonc` with smart caching and dependency management.

### Task Execution Order

Tasks respect package dependencies using the `^` prefix (e.g., `"dependsOn": ["^build"]`). This ensures:

- **Dependencies are processed first**: When you run `turbo run build`, it builds `nextly` before `@nextly/admin` (which depends on it)
- **Topological sorting**: Turbo automatically determines the correct execution order based on your package.json dependencies
- **Parallel execution**: Independent packages build concurrently for maximum speed

### Key Tasks

| Task          | Cache | Dependencies | Purpose                                   |
| ------------- | ----- | ------------ | ----------------------------------------- |
| `build`       | Yes   | `^build`     | Builds all packages in dependency order   |
| `check-types` | Yes   | `^build`     | TypeScript type checking                  |
| `clean`       | No    | `^clean`     | Removes dist/ folders (topological order) |
| `dev`         | No    | `^build`     | Starts development servers (persistent)   |
| `format`      | No    | None         | Formats code with Prettier                |
| `lint`        | Yes   | `^build`     | Lints all packages                        |
| `test`        | Yes   | `^build`     | Runs all tests with coverage              |

### Why Some Tasks Don't Cache

- **`clean`**: Destructive operation - always runs to ensure clean state
- **`format`**: Modifies files in-place - caching would prevent formatting
- **`dev`**: Long-running server - no benefit from caching
- **`lint:fix`**: Modifies files - needs to run to apply fixes

### Input Exclusions

Turbo automatically excludes from task inputs:

- `node_modules/**` (dependencies)
- `.git/**` (version control)
- `dist/**` (build outputs)
- Files in `.gitignore`

No need to explicitly exclude these in most cases.

**For more details on Turbo configuration, see:** [Turborepo Docs](https://turbo.build/repo/docs)

---

## Architecture

Architecture documentation coming soon. For now, explore the codebase:

- **Core package:** `packages/nextly/src/`
- **Admin package:** `packages/admin/src/`
- **Analysis reports:** `reports/` folder

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Telemetry

The Nextly CLI (`create-nextly-app` and `nextly`) collects anonymous usage
data to help us improve the tool. No personal information, project contents,
file paths, or secrets are collected. Telemetry is automatically disabled in
CI, Docker, production, and non-interactive shells.

See [nextlyhq.com/docs/telemetry](https://nextlyhq.com/docs/telemetry) for
the full list of what is and is not collected, and for instructions on
opting out (`nextly telemetry disable` or `NEXTLY_TELEMETRY_DISABLED=1`).

## License

MIT
