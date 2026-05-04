---
"@revnixhq/admin": patch
"@revnixhq/nextly": patch
---

Fix two issues on the user edit page:

- Avatar selection now actually persists when saving (was visually updating but not committing — root cause: both the admin form-level Zod schema (`avatarUrl.url()`) and the backend `UpdateUserSchema`/`CreateLocalUserSchema` `image` regex required a fully-qualified `http(s)://` URL, so the relative `/uploads/...` paths returned by the local media adapter failed validation and submission silently aborted; the validators now also accept server-relative paths).
- Role and "Roles & Settings" dropdowns now have correct contrast in both light and dark modes (was using hardcoded `bg-slate-700 text-white` and `bg-primary/5 text-primary` classes that didn't switch with the theme; replaced with `bg-accent` / `text-accent-foreground` theme tokens).
