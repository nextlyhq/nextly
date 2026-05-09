# Access

Access-control functions used by `defineCollection({ access: ... })`
and `defineSingle({ access: ... })`. Each function decides whether the
current user can perform an action (read, create, update, delete) on a
collection or single.

Conventions:

- One function per file. File name matches the function name.
- Export the function as a named export.
- Type signature: `AccessControlFunction` from `nextly`.

Common patterns shipped in the blog template (for reference):

- `anyone.ts` — always allow (use for public reads).
- `authenticated.ts` — require any logged-in user.
- `is-admin.ts` — require the `admin` role.
- `is-author-or-editor.ts` — require one of several roles.

Add your own here as your project grows. Wire them up in your
collections / singles config.
