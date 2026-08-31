---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

You can now ask for work to happen later.

```ts
await nextly.jobs.queue({
  task: "email:welcome",
  input: { userId: user.id },
  runAt: tomorrowAt9am,
  runAs: user.id,
});
```

Queueing returns as soon as the job is recorded, not when the work is done — so
a slow task no longer has to happen inside the request that asked for it. The job
is a row in your database, so it survives a restart and runs when a trigger next
drains the queue.

`runAt` says when the job may START. Omit it and the job runs at the next drain.

`runAs` names whose authority the job carries. Omit it and the job acts as
nobody — which is not the same as acting as the system: a job with no identity
gets a content client with no privileges rather than a privileged one. Never take
this value from a request body; choosing whose authority to spend is the caller's
decision to make deliberately.

`dedupeKey` suppresses a duplicate while an equal key is still outstanding, and
the key is released once the job finishes. That makes it "one export per document
at a time" rather than "one export ever", so recurring work keeps working.

`input` is typed from the task name once you declare your job types:

```ts
declare module "nextly" {
  export interface GeneratedTypes {
    jobs: { "email:welcome": { userId: string } };
  }
}
```

This is the same interface that already types your collection and single slugs,
so there is one place to declare what your project contains. Without it, task
names are ordinary strings and input is unchecked — nothing breaks, you simply
get no inference.

Plugins can declare and queue job types too, via `@nextlyhq/plugin-sdk`. Marked
experimental there until a first-party plugin ships one.
