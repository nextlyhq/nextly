/**
 * The SEO site's content and the SEO plugin, as a site configures them.
 *
 * One collection, `posts`, served at `/posts/<slug>`, whose addresses moved
 * there from `/articles/<slug>` with this deploy. `SEO_SITE_GONE_PAGE` names the site's own
 * page for a Gone answer; unset, a Gone address gets the plugin's plain page.
 * The site's address comes from `NEXT_PUBLIC_APP_URL`, so robots.txt and the
 * sitemap name it and the plugin treats it as the production address.
 */
import { seoPlugin } from "@nextlyhq/plugin-seo";
import {
  defineCollection,
  defineConfig,
  text,
  type SanitizedNextlyConfig,
} from "nextly/config";

export const Posts = defineCollection({
  slug: "posts",
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
  ],
  // Where a deploy serves them. The setup scripts run with
  // `SEO_SITE_POSTS_AT` naming where the deploy before it served them, so the
  // build and the first start meet addresses that moved.
  publicAddress: process.env.SEO_SITE_POSTS_AT ?? "/posts/{slug}",
});

const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
const gonePage = process.env.SEO_SITE_GONE_PAGE;

// Typed as the public config type: the plugin's dashboard card adds a widget
// record whose own name is not exported.
const config: SanitizedNextlyConfig = defineConfig({
  collections: [Posts],
  plugins: [
    seoPlugin({
      collections: [Posts.slug],
      ...(baseUrl ? { baseUrl } : {}),
      ...(gonePage ? { gonePage } : {}),
    }),
  ],
});

export default config;
