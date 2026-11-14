/**
 * Readies the SEO site's database outside any request, as a deployment's
 * scripts do. Its steps, in the order the driver runs them:
 *
 *   tsx scripts/setup.ts content    the account and two posts
 *   tsx scripts/setup.ts settings   the SEO settings in SEO_SITE_SETTINGS (JSON)
 *
 * `content` runs before `nextly plugins install`, as the playground's seed
 * does; `settings` after it, since the settings Single is the plugin's.
 * The account is `SEO_SITE_EMAIL` with `SEO_SITE_PASSWORD`.
 */
import { getNextly, shutdownNextly } from "nextly";
import { seedPermissions, seedSuperAdmin } from "nextly/database/seeders";

import config, { Posts } from "../nextly.config";

const step = process.argv[2];

/** `name` from the environment, which the driver always sets. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is unset`);
  return value;
}

const nextly = await getNextly({ config });
try {
  if (step === "content") {
    // The seeders take the connected adapter, which the instance holds.
    const { adapter } = nextly as unknown as {
      adapter: Parameters<typeof seedPermissions>[0];
    };
    await seedPermissions(adapter, { silent: true });
    await seedSuperAdmin(adapter, {
      email: required("SEO_SITE_EMAIL"),
      password: required("SEO_SITE_PASSWORD"),
      name: "SEO site owner",
      silent: true,
    });
    for (const slug of ["first-post", "second-post"]) {
      await nextly.create({
        collection: Posts.slug,
        data: { title: slug.replace("-", " "), slug },
      });
    }
  } else if (step === "settings") {
    await nextly.updateSingle({
      slug: "seo-settings",
      // Replaces what the plugin stored at install: no earlier read to name.
      data: {
        ...(JSON.parse(required("SEO_SITE_SETTINGS")) as Record<
          string,
          unknown
        >),
        _overwrite: true,
      },
    });
  } else {
    throw new Error("usage: setup.ts content|settings");
  }
} finally {
  await shutdownNextly();
}
console.log(`seo-site setup: ${step} done`);
