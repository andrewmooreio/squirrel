import { createApp } from "../app/app";
import { d1Driver } from "../db/drivers/d1";
import build from "../generated/build.json";

interface Env {
  DB: D1Database;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    if (!env.DB) {
      return new Response("The D1 binding named DB is missing. Add it to the Wrangler config.\n", {
        status: 500,
      });
    }
    // Hono and the driver are cheap to make. The migration check runs once for each driver.
    return getApp(env.DB).fetch(request);
  },
};

// One app for each D1 binding, so the migration check runs once in each isolate.
const apps = new WeakMap<D1Database, ReturnType<typeof createApp>>();
function getApp(db: D1Database) {
  let app = apps.get(db);
  if (!app) {
    app = createApp({ driver: d1Driver(db), version: build.version });
    apps.set(db, app);
  }
  return app;
}
