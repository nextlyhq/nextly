# Husky Configuration

This project uses Husky for Git hooks with the following setup:

## Hooks

### Pre-commit (`pre-commit`)

- Runs `npx lint-staged` to format staged files with Prettier
- Ensures code formatting consistency before commits

### Commit-msg (`commit-msg`)

- Validates commit messages using commitlint
- Enforces conventional commit format
- Configured scopes: `adminapp`, `db`, `eslint-config`, `tailwind-config`, `typescript-config`, `root`

### Pre-push (`pre-push`)

- Runs `pnpm run build` to ensure all packages build successfully
- Prevents pushing broken code

## Usage

The hooks run automatically on git operations:

- `git commit` - triggers pre-commit and commit-msg hooks
- `git push` - triggers pre-push hook

## Commit Message Format

Use conventional commits format:

```
type(scope): description

body (optional)

footer (optional)
```

### Types

- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions/changes
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Maintenance tasks
- `revert`: Revert previous commits

### Examples

- `feat(adminapp): add user authentication`
- `fix(db): resolve connection pool issue`
- `docs(root): update README with setup instructions`
