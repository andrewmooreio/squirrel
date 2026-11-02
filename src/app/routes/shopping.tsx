import type { Hono } from "hono";
import { Shopping, type ShoppingGroup } from "../../views/shopping";
import { type Deps, page, render } from "../http";
import type { Item } from "../store";

const NO_STORE = "No store";

/** Groups items by store, in store-name order regardless of case. Items with no store come last. */
export function groupByStore(items: Item[]): ShoppingGroup[] {
  const at = new Map<number, ShoppingGroup>();
  const none: Item[] = [];
  for (const it of items) {
    if (it.storeName === "") {
      none.push(it);
      continue;
    }
    let g = at.get(it.storeId);
    if (!g) {
      g = { store: it.storeName, items: [] };
      at.set(it.storeId, g);
    }
    g.items.push(it);
  }
  const groups = [...at.values()].sort((a, b) =>
    a.store.toLowerCase() < b.store.toLowerCase()
      ? -1
      : a.store.toLowerCase() > b.store.toLowerCase()
        ? 1
        : 0,
  );
  if (none.length > 0) groups.push({ store: NO_STORE, items: none });
  return groups;
}

export function shoppingRoutes(app: Hono, d: Deps) {
  app.get("/shopping", async (c) => {
    const items = await d.store.listItems({ list: "on" });
    return render(
      c,
      200,
      <Shopping page={page(d, "Shopping list", "shopping")} groups={groupByStore(items)} />,
    );
  });
}
