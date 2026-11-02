import build from "../generated/build.json";
import type { Page } from "./helpers";

const asset = (path: string) =>
  `/static/${path}?v=${(build.assets as Record<string, string>)[path] ?? "dev"}`;

// A header link is current when it matches the page.
const navVariant = (current: string, link: string) => (current === link ? "secondary" : "ghost");

export function Layout({ page, children }: { page: Page; children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{page.title}</title>
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/static/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Squirrel" />
        <link rel="stylesheet" href={asset("app.css")} />
        <script src={asset("app.js")} />
        <script src={asset("vendor/htmx.min.js")} defer />
      </head>
      <body>
        <header class="border-b pt-[env(safe-area-inset-top)]">
          <div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <a href="/" class="flex min-w-0 items-center gap-2 text-lg font-semibold">
              <img src="/static/icon.svg" alt="" class="size-8 rounded-lg" />
              Squirrel
            </a>
            <div class="flex shrink-0 gap-1">
              <a
                href="/shopping"
                class="btn whitespace-nowrap"
                data-variant={navVariant(page.nav, "shopping")}
                data-size="sm"
              >
                Shopping list
              </a>
              <a
                href="/lists/categories"
                class="btn whitespace-nowrap"
                data-variant={navVariant(page.nav, "lists")}
                data-size="sm"
              >
                Manage lists
              </a>
            </div>
          </div>
        </header>
        <main class="mx-auto w-full max-w-5xl px-4 py-4">{children}</main>
        <footer class="mx-auto w-full max-w-5xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
          Squirrel {page.version}
        </footer>
      </body>
    </html>
  );
}

/** A small full page for errors and notices. */
export function Message(props: {
  page: Page;
  heading: string;
  body: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <Layout page={props.page}>
      <section class="empty mx-auto max-w-md py-12">
        <header>
          <h1 class="text-xl font-semibold">{props.heading}</h1>
          <p>{props.body}</p>
        </header>
        <a href={props.backHref} class="btn" data-variant="outline">
          {props.backLabel}
        </a>
      </section>
    </Layout>
  );
}
