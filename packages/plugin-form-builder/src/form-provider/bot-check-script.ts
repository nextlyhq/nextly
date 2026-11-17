/**
 * The forms plugin's own script for its forms on a page builder page: it
 * draws the bot check's widget (Cloudflare Turnstile, or Google reCAPTCHA v3)
 * into the hidden answer the form's description adds for it, so the token
 * is posted with the form, and fills the browser's own token for a form
 * taking one response per browser.
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
export const BOT_CHECK_SCRIPT = `
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
  const form = input.form;
  const box = document.createElement("div");
  input.after(box);
  // A send made before the widget gives its token is held, then sent once
  // the token arrives: a send without one is kept as spam.
  let held = false;
  if (form) {
    form.addEventListener("submit", event => {
      if (input.value !== "") return;
      event.preventDefault();
      held = true;
    });
  }
  load("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit").then(() => {
    window.turnstile.render(box, {
      sitekey: siteKey,
      "response-field": false,
      callback: token => {
        input.value = token;
        if (held && form) {
          held = false;
          form.submit();
        }
      },
    });
  });
}
function recaptcha(input, siteKey) {
  const form = input.form;
  if (!form) return;
  const ready = load("https://www.google.com/recaptcha/api.js?render=" + encodeURIComponent(siteKey));
  form.addEventListener("submit", event => {
    if (input.value !== "") return;
    // Held until the token is made, even while Google's script still loads:
    // a send without one is kept as spam.
    event.preventDefault();
    ready
      .then(() => new Promise(resolve => window.grecaptcha.ready(resolve)))
      .then(() => window.grecaptcha.execute(siteKey, { action: "submit" }))
      .then(token => {
        input.value = token;
        form.submit();
      });
  });
}
function browserToken() {
  const key = "nextly-forms-browser-token";
  try {
    const kept = localStorage.getItem(key);
    if (kept && /^[A-Za-z0-9_-]{16,128}$/.test(kept)) return kept;
  } catch {}
  const made = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  try { localStorage.setItem(key, made); } catch {}
  return made;
}
for (const input of document.querySelectorAll("input[data-forms-browser-token]")) {
  input.value = browserToken();
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
