/**
 * The forms plugin's own script for its forms on a page builder page: it
 * draws the bot check's widget (Cloudflare Turnstile, or Google reCAPTCHA v3)
 * into the hidden answer the form's description adds for it, so the token
 * is posted with the form.
 *
 * Served by one public route of the plugin, as a module the page builder
 * adds only to pages drawing a form that has a bot check. A form with none
 * needs no script, and the page carries none.
 *
 * Without JavaScript no token is sent, and the plugin keeps such a send as
 * spam, as it does at its JSON address.
 *
 * @module form-provider/bot-check-script
 */
import type { PluginRoute } from "nextly";

/** Where the module is served, within the plugin's routes. */
export const BOT_CHECK_SCRIPT_PATH = "/page-forms/bot-check.js";

/**
 * The module. Plain browser JavaScript, written once: it reads only the
 * `data-forms-*` values the form's description put on its hidden answer.
 */
const BOT_CHECK_SCRIPT = `
const loaded = new Map();
function load(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.onload = resolve;
      tag.onerror = reject;
      document.head.append(tag);
    }));
  }
  return loaded.get(src);
}
function turnstile(input, siteKey) {
  const box = document.createElement("div");
  input.after(box);
  load("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit").then(() => {
    window.turnstile.render(box, {
      sitekey: siteKey,
      "response-field": false,
      callback: token => { input.value = token; },
    });
  });
}
function recaptcha(input, siteKey) {
  const form = input.form;
  if (!form) return;
  load("https://www.google.com/recaptcha/api.js?render=" + encodeURIComponent(siteKey));
  form.addEventListener("submit", event => {
    if (input.value !== "" || !window.grecaptcha) return;
    event.preventDefault();
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(siteKey, { action: "submit" }).then(token => {
        input.value = token;
        form.submit();
      });
    });
  });
}
for (const input of document.querySelectorAll("input[data-forms-bot-check]")) {
  const siteKey = input.dataset.formsSiteKey;
  if (!siteKey) continue;
  if (input.dataset.formsBotCheck === "turnstile") turnstile(input, siteKey);
  else if (input.dataset.formsBotCheck === "recaptcha") recaptcha(input, siteKey);
}
`;

/** The public route serving {@link BOT_CHECK_SCRIPT}. */
export function botCheckScriptRoute(): PluginRoute {
  return {
    method: "GET",
    path: BOT_CHECK_SCRIPT_PATH,
    public: true,
    handler: () =>
      new Response(BOT_CHECK_SCRIPT, {
        status: 200,
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      }),
  };
}
