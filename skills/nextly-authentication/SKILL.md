---
name: nextly-authentication
description: >-
  Use when deciding who can sign in to a Nextly project and what they can do:
  the first admin account, roles, access rules on collections, API keys for
  other apps and scripts, checking the signed-in user in your own server
  code, and extra fields on users. Also use when asked to add login or
  sign-up to a Nextly site, so the answer matches what Nextly provides.
metadata:
  nextly-version: 0.0.2-alpha.67
---

# Authentication and access in Nextly

Checked against `nextly` 0.0.2-alpha.67 with Next.js 16.4. Run
`npx nextly --version`; if it prints a newer version, prefer
<https://nextlyhq.com/docs/guides/authentication> where it disagrees with this
skill.

## What is built in, and what is not

Nextly has its own email and password sign-in for the **people who run the
site**: admins, editors and authors who use the admin panel at `/admin`. It is
not built on NextAuth or any OAuth library, and it needs no setup beyond
`NEXTLY_SECRET`.

Its session cookies are scoped to `/admin`. So in this release Nextly does
**not** provide sign-in for the visitors of your public site, nor social or
OAuth login. If the site needs visitor accounts, use an auth library for the
site and keep Nextly for content; do not try to reuse the admin sign-in for
visitors.

In particular, do not build a sign-in form for your own pages on the Direct
API's `nextly.login()`. It is for trusted server code, not for signing people
in, and this release has no ready path for members-only pages. Protect those
with the auth library the site uses.

## The secret

`NEXTLY_SECRET` signs the session tokens. The installer generates one in
`.env`. In production it must be at least 32 characters; generate one with:

```bash
openssl rand -base64 32
```

Never commit it, and use a different one per environment.

## The first admin

Open `/admin/setup` once, on an empty database, and create the first account.
It gets the **Super Admin** role, which passes every check. After that, setup
is closed, and people are added in the admin under **Users**.

Built-in roles: `super-admin`, `admin`, `editor`, `author`, `viewer`. Roles and
their permissions are managed in the admin under **Settings > Roles**.

## Access rules on a collection

Each operation takes `true`, `false` or a function. A function receives
`{ user, roles, permissions, operation, collection }`, where `roles` are role
slugs such as `"editor"` and `user` is `null` for a request with no session.

```ts
import { defineCollection, text } from "nextly/config";
import type { AccessControlFunction } from "nextly";

const signedIn: AccessControlFunction = ({ user }) => Boolean(user);
const editors: AccessControlFunction = ({ roles }) =>
  roles.includes("admin") || roles.includes("editor");

export const Articles = defineCollection({
  slug: "articles",
  fields: [text({ name: "title", required: true })],
  access: {
    read: () => true,
    create: signedIn,
    update: editors,
    delete: editors,
  },
});
```

- A Super Admin passes every rule; test rules with another role.
- These rules are applied to requests to the admin API and to Direct API
  reads made with `overrideAccess: false`. A plain server-side
  `nextly.find(...)` is a trusted read that skips them.
- `read: () => true` does not make the admin API public. Every request to
  `/admin/api/...` needs a session or an API key, and is refused with 401
  otherwise. Public pages read content on the server with `getNextly` (the
  `nextly-collections` skill).

To apply the rules for a particular user in server code:

```ts
const result = await nextly.find({
  collection: "articles",
  overrideAccess: false,
  user: { id: userId },
});
```

## API keys, for other apps and scripts

Create keys in the admin under **Settings > API Keys**. The full key is shown
once. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer $NEXTLY_API_KEY" \
  "https://example.com/admin/api/collections/posts/entries?limit=10"
```

A **Read-only** key can read and is refused writes (403). **Full access**
carries its creator's permissions; **Role-based** carries the permissions of a
role you choose. Keys can expire and be revoked. Keep keys in environment
variables, never in client code.

## The signed-in user in your own server code

```ts
// src/app/admin/me/route.ts: the session cookie only reaches /admin paths
import { getNextly } from "nextly";
import { getSession, isSuperAdmin } from "nextly/auth";

import nextlyConfig from "../../../../nextly.config";

export async function GET(request: Request) {
  // Start Nextly first: this route may be the first request a server handles.
  await getNextly({ config: nextlyConfig });
  const session = await getSession(request, process.env.NEXTLY_SECRET ?? "");
  if (!session.authenticated) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  return Response.json({
    email: session.user.email,
    superAdmin: await isSuperAdmin(session.user.id),
  });
}
```

- The route must live under `/admin`, or the browser never sends the session
  cookie to it.
- `session.user.roleIds` holds role **IDs**, not role slugs, so
  `hasRole(user, "editor")` from `nextly/auth` does not match by slug in this
  release. Use `isSuperAdmin(user.id)`, or put role decisions in collection
  access rules, where `roles` are slugs.

## Extra fields on users

```ts
import { defineConfig, text, textarea } from "nextly/config";

export default defineConfig({
  users: {
    fields: [
      textarea({ name: "bio", maxLength: 500 }),
      text({ name: "avatarUrl" }),
    ],
  },
  // collections, typescript, ...
});
```

Read users with `nextly.users.find()`, not `find({ collection: "users" })`.

## Password reset and verification emails

These need an email provider. Without one, tokens come back in the API
response as a development fallback. See
<https://nextlyhq.com/docs/guides/email>.

## Check it worked

- `/admin/setup` creates the first account, and `/admin` signs in.
- A request to `/admin/api/collections/<slug>/entries` without a session or
  key answers 401.
- A read-only API key reads entries and gets 403 on a write.
