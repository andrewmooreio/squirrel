import type { Hono } from "hono";
import type { ItemFilter } from "../../db/types";
import { Home, Main, Stock, type StockData, type Tab } from "../../views/home";
import { type Deps, fragment, hxTargetId, isHTMX, page, render } from "../http";
import { parseId } from "../validate";

const TAB_NONE = "none";

interface View {
  tab: string;
  q: string;
  locationId: number;
  storeId: number;
  sort: string;
}

/** The URL of the main page for a tab. It keeps the search and the filters. */
function href(v: View, tab: string): string {
  const vals: [string, string][] = [];
  if (v.locationId) vals.push(["loc", String(v.locationId)]);
  if (v.q) vals.push(["q", v.q]);
  if (v.sort) vals.push(["sort", v.sort]);
  if (v.storeId) vals.push(["store", String(v.storeId)]);
  if (tab) vals.push(["tab", tab]);
  if (vals.length === 0) return "/";
  return `/?${new URLSearchParams(vals).toString()}`;
}

export function homeRoutes(app: Hono, d: Deps) {
  app.get("/", async (c) => {
    const v: View = {
      tab: c.req.query("tab") ?? "",
      q: (c.req.query("q") ?? "").trim(),
      locationId: parseId(c.req.query("loc")),
      storeId: parseId(c.req.query("store")),
      sort: c.req.query("sort") ?? "",
    };

    const [cats, locs, stores, hasUncategorised] = await Promise.all([
      d.store.lists("categories"),
      d.store.lists("locations"),
      d.store.lists("stores"),
      d.store.hasUncategorised(),
    ]);

    // While a search is active the view acts as the All tab.
    let active = v.q ? "" : v.tab;
    const f: ItemFilter = {
      search: v.q,
      locationId: v.locationId,
      storeId: v.storeId,
      sort: v.sort,
    };
    if (active === TAB_NONE) {
      f.uncategorised = true;
    } else if (active !== "") {
      f.categoryId = parseId(active);
      if (f.categoryId === 0) active = "";
    }
    const items = await d.store.listItems(f);

    const tabs: Tab[] = [{ label: "All", href: href(v, ""), active: active === "" }];
    for (const cat of cats) {
      const id = String(cat.id);
      tabs.push({ label: cat.name, href: href(v, id), active: active === id });
    }
    if (hasUncategorised) {
      tabs.push({ label: "Uncategorised", href: href(v, TAB_NONE), active: active === TAB_NONE });
    }

    const missing: string[] = [];
    if (cats.length === 0) missing.push("category");
    if (locs.length === 0) missing.push("location");
    if (stores.length === 0) missing.push("store");

    const stock: StockData = {
      tabs,
      items,
      anyItems: items.length > 0,
      canAdd: missing.length === 0,
      missing,
      filtered: Boolean(v.q || v.locationId || v.storeId),
      clearHref: href({ tab: "", q: "", locationId: 0, storeId: 0, sort: v.sort }, active),
    };
    if (items.length === 0) stock.anyItems = (await d.store.listItems()).length > 0;

    const data = {
      tab: v.tab,
      query: v.q,
      locationId: v.locationId,
      storeId: v.storeId,
      sort: v.sort,
      locations: locs,
      stores,
      stock,
    };

    c.header("Vary", "HX-Request, HX-Target");
    if (isHTMX(c) && hxTargetId(c) === "stock") return fragment(c, 200, <Stock data={stock} />);
    if (isHTMX(c)) return fragment(c, 200, <Main data={data} />);
    return render(c, 200, <Home page={page(d, "Stock")} data={data} />);
  });
}
