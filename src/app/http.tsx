import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Page } from "../views/helpers";
import { Message } from "../views/layout";
import { NotFoundError } from "./errors";
import type { Store } from "./store";
import { atoi } from "./validate";

/** What every route needs. */
export interface Deps {
  store: Store;
  /** The version for people to read: 1.1.0 shows as v1.1.0. */
  version: string;
}

/** A release number gets a v. Other builds, such as dev or edge-abc1234, stay as they are. */
export const versionLabel = (v: string) => (/^\d/.test(v) ? `v${v}` : v);

export const page = (d: Deps, title: string, nav = ""): Page => ({
  title: `${title} · Squirrel`,
  nav,
  version: versionLabel(d.version),
});

/** Sends a full page. */
export const render = (c: Context, status: number, node: unknown) =>
  c.html(`<!DOCTYPE html>${String(node)}`, status as ContentfulStatusCode);

/** Sends a fragment for HTMX. */
export const fragment = (c: Context, status: number, node: unknown) =>
  c.html(String(node), status as ContentfulStatusCode);

export const message = (
  c: Context,
  d: Deps,
  status: number,
  heading: string,
  body: string,
  back: { href: string; label: string; nav?: string } = { href: "/", label: "Back to the list" },
) =>
  render(
    c,
    status,
    <Message
      page={page(d, heading, back.nav ?? "")}
      heading={heading}
      body={body}
      backHref={back.href}
      backLabel={back.label}
    />,
  );

export const notFound = (c: Context, d: Deps) =>
  message(c, d, 404, "Not found", "This page does not exist.");

/** An HTMX request is not a full page load or a history restore. */
export const isHTMX = (c: Context) =>
  c.req.header("HX-Request") === "true" && c.req.header("HX-History-Restore-Request") !== "true";

/** HTMX 4 sends the target as tag#id, for example div#stock. Returns the id. */
export const hxTargetId = (c: Context) => {
  const t = c.req.header("HX-Target") ?? "";
  const i = t.indexOf("#");
  return i < 0 ? "" : t.slice(i + 1);
};

/** Redirects to the page the form came from, or to fallback. */
export function backTo(c: Context, fallback: string) {
  let dest = fallback;
  const referer = c.req.header("Referer");
  if (referer) {
    try {
      const ref = new URL(referer, c.req.url);
      const host = c.req.header("Host") ?? new URL(c.req.url).host;
      if (ref.pathname.startsWith("/") && !ref.pathname.startsWith("//") && ref.host === host) {
        dest = ref.pathname + ref.search;
      }
    } catch {
      // A bad Referer means no back link.
    }
  }
  return c.redirect(dest, 303);
}

/** Reads a form body. A body that is not a form gives an empty form. */
export async function readForm(c: Context): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const body = await c.req.parseBody();
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
  } catch {
    // Not a form.
  }
  return out;
}

export const pathIdOf = (c: Context, name: string): number | null => {
  const n = atoi(c.req.param(name) ?? "");
  return n !== null && n > 0 ? n : null;
};

export { NotFoundError };
