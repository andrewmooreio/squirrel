import { type Context, Hono } from "hono";
import type { Driver } from "../db/types";
import { NotFoundError } from "./errors";
import { type Deps, message, notFound } from "./http";
import { apiError, apiRoutes } from "./routes/api";
import { homeRoutes } from "./routes/home";
import { itemRoutes } from "./routes/items";
import { listRoutes } from "./routes/lists";
import { shoppingRoutes } from "./routes/shopping";
import { transferRoutes } from "./routes/transfer";
import { createStore } from "./store";

export interface AppOptions {
  driver: Driver;
  /** The build version: 1.2.0, dev or edge-abc1234. */
  version: string;
  /** Serves /static/… on hosts that have no asset server of their own. */
  assets?: (req: Request) => Promise<Response | null> | Response | null;
}

const MANIFEST = `{
  "name": "Squirrel",
  "short_name": "Squirrel",
  "description": "Count the stock in your house.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#f97316",
  "icons": [
    {"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
    {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    {"src": "/static/icon.svg", "sizes": "any", "type": "image/svg+xml"}
  ]
}
`;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a change sent from another website. It copies Go's
 * http.CrossOriginProtection. Hono's csrf() checks the Origin header only.
 */
function crossOrigin(d: Deps) {
  return async (c: Context, next: () => Promise<void>) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const site = c.req.header("Sec-Fetch-Site");
    let allowed = true;
    if (site !== undefined) {
      allowed = site === "same-origin" || site === "none";
    } else {
      const origin = c.req.header("Origin");
      if (origin !== undefined) {
        const host = c.req.header("Host") ?? new URL(c.req.url).host;
        try {
          allowed = new URL(origin).host === host;
        } catch {
          allowed = false;
        }
      }
    }
    if (allowed) return next();
    return message(
      c,
      d,
      403,
      "Request refused",
      "This change came from another website. Make the change in Squirrel.",
    );
  };
}

/** Builds the whole app. It uses only web-standard Request and Response. */
export function createApp(options: AppOptions): Hono {
  const store = createStore(options.driver);
  const deps: Deps = { store, version: options.version };
  const app = new Hono();

  app.use("*", crossOrigin(deps));

  app.get("/healthz", async (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "no-store");
    try {
      await Promise.race([
        store.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
      return c.body("ok\n");
    } catch {
      return c.body("database unreachable\n", 503);
    }
  });

  app.get("/manifest.webmanifest", (c) => {
    c.header("Content-Type", "application/manifest+json");
    return c.body(MANIFEST);
  });

  app.get("/static/*", async (c) => {
    const res = await options.assets?.(c.req.raw);
    return res ?? notFound(c, deps);
  });

  homeRoutes(app, deps);
  shoppingRoutes(app, deps);
  transferRoutes(app, deps);
  itemRoutes(app, deps);
  listRoutes(app, deps);
  apiRoutes(app, deps);

  app.notFound((c) => notFound(c, deps));

  app.onError((err, c) => {
    const api = new URL(c.req.url).pathname.startsWith("/api/");
    if (err instanceof NotFoundError)
      return api ? apiError(c, 404, "Not found.") : notFound(c, deps);
    console.error(`${c.req.method} ${new URL(c.req.url).pathname}:`, err);
    if (api) return apiError(c, 500, "Something went wrong.");
    return message(
      c,
      deps,
      500,
      "Something went wrong",
      "Try again. If it keeps happening, check the server log.",
    );
  });

  return app;
}
