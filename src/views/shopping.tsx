import type { Item } from "../app/store";
import type { Page } from "./helpers";
import { Row } from "./home";
import { Layout } from "./layout";

export interface ShoppingGroup {
  store: string;
  items: Item[];
}

export function Shopping({ page, groups }: { page: Page; groups: ShoppingGroup[] }) {
  return (
    <Layout page={page}>
      <div class="grid gap-4">
        <header>
          <h1 class="text-xl font-semibold">Shopping list</h1>
          <p class="text-sm text-muted-foreground">
            Items you added to the shopping list, grouped by store.
          </p>
        </header>
        {groups.length === 0 ? (
          <section class="empty py-12">
            <header>
              <h2 class="text-lg font-semibold">Nothing to buy</h2>
              <p>Tap the cart on an item to add it to the list.</p>
            </header>
            <a href="/" class="btn" data-variant="outline">
              Back to the list
            </a>
          </section>
        ) : (
          groups.map((g) => (
            <section class="grid gap-2">
              <h2 class="text-lg font-semibold">{g.store}</h2>
              <ul class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
                {g.items.map((it) => (
                  <Row item={it} msg="" />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Layout>
  );
}
