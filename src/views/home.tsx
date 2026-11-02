import type { Item, ListValue } from "../app/store";
import type { Page } from "./helpers";
import {
  boolStr,
  idStr,
  isSelected,
  itemAction,
  itemUrl,
  onValue,
  orDash,
  rowId,
  rowTarget,
} from "./helpers";
import { Layout } from "./layout";

export interface Tab {
  label: string;
  href: string;
  active: boolean;
}

export interface StockData {
  tabs: Tab[];
  items: Item[];
  /** True if the database has at least one item, filtered or not. */
  anyItems: boolean;
  canAdd: boolean;
  /** The managed lists that are still empty. */
  missing: string[];
  /** True if a search or a filter is active. */
  filtered: boolean;
  clearHref: string;
}

export interface HomeData {
  tab: string;
  query: string;
  locationId: number;
  storeId: number;
  sort: string;
  locations: ListValue[];
  stores: ListValue[];
  stock: StockData;
}

export function Home({ page, data }: { page: Page; data: HomeData }) {
  return (
    <Layout page={page}>
      <div id="main" class="grid gap-4">
        <Main data={data} />
      </div>
    </Layout>
  );
}

const filterAttrs = {
  "hx-get": "/",
  "hx-trigger": "change",
  "hx-target": "#stock",
  "hx-include": "#filters",
  "hx-replace-url": "true",
};

/** The search form plus the #stock region. A tab click swaps it. */
export function Main({ data: d }: { data: HomeData }) {
  return (
    <>
      <form
        id="filters"
        method="get"
        action="/"
        class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[1fr_10rem_10rem_10rem_auto]"
      >
        <input type="hidden" name="tab" value={d.tab} />
        <input
          type="search"
          name="q"
          value={d.query}
          placeholder="Search items"
          aria-label="Search items"
          autocomplete="off"
          class="input col-span-2 h-11 sm:col-span-4 lg:col-span-1"
          hx-get="/"
          hx-trigger="input changed delay:200ms, search"
          hx-target="#stock"
          hx-include="#filters"
          hx-replace-url="true"
          hx-sync="this:replace"
        />
        <select
          name="loc"
          aria-label="Filter by location"
          class="select h-11 w-full"
          {...filterAttrs}
        >
          <option value="">All locations</option>
          {d.locations.map((v) => (
            <option value={idStr(v.id)} selected={isSelected(v.id, d.locationId)}>
              {v.name}
            </option>
          ))}
        </select>
        <select
          name="store"
          aria-label="Filter by store"
          class="select h-11 w-full"
          {...filterAttrs}
        >
          <option value="">All stores</option>
          {d.stores.map((v) => (
            <option value={idStr(v.id)} selected={isSelected(v.id, d.storeId)}>
              {v.name}
            </option>
          ))}
        </select>
        <select name="sort" aria-label="Sort items" class="select h-11 w-full" {...filterAttrs}>
          <option value="" selected={d.sort === ""}>
            Sort: A to Z
          </option>
          <option value="name-desc" selected={d.sort === "name-desc"}>
            Sort: Z to A
          </option>
          <option value="count" selected={d.sort === "count"}>
            Sort: Lowest count first
          </option>
          <option value="updated" selected={d.sort === "updated"}>
            Sort: Recently changed
          </option>
        </select>
        {d.stock.canAdd ? (
          <a href="/items/new" class="btn h-11">
            Add item
          </a>
        ) : (
          <a href="/lists/categories" class="btn h-11" data-variant="secondary">
            Set up lists
          </a>
        )}
        <noscript>
          <button type="submit" class="btn" data-variant="outline">
            Search
          </button>
        </noscript>
      </form>
      <Stock data={d.stock} />
    </>
  );
}

export function Stock({ data: d }: { data: StockData }) {
  return (
    <div id="stock" class="grid gap-3">
      <nav aria-label="Categories" class="tab-scroll -mx-4 px-4">
        <div class="tabs">
          <div role="tablist" aria-orientation="horizontal" data-variant="line" class="min-w-max">
            {d.tabs.map((t) => (
              <a
                role="tab"
                href={t.href}
                aria-selected={boolStr(t.active)}
                hx-get={t.href}
                hx-target="#main"
                hx-push-url="true"
                class="h-11 px-4"
              >
                {t.label}
              </a>
            ))}
          </div>
        </div>
      </nav>
      {d.items.length === 0 ? (
        <EmptyState data={d} />
      ) : (
        <ul class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
          {d.items.map((it) => (
            <Row item={it} msg="" />
          ))}
        </ul>
      )}
    </div>
  );
}

function Missing({ names }: { names: string[] }) {
  return (
    <>
      {names.map((m, i) => (
        <>
          {i > 0 ? (i === names.length - 1 ? " and " : ", ") : ""}
          <strong>{m}</strong>
        </>
      ))}
    </>
  );
}

function EmptyState({ data: d }: { data: StockData }) {
  if (!d.anyItems && !d.canAdd) {
    return (
      <section class="empty py-12">
        <header>
          <h2 class="text-lg font-semibold">Welcome to Squirrel</h2>
          <p>
            Before you add items, create at least one <Missing names={d.missing} /> in Manage lists.
          </p>
        </header>
        <a href="/lists/categories" class="btn">
          Manage lists
        </a>
      </section>
    );
  }
  if (!d.anyItems) {
    return (
      <section class="empty py-12">
        <header>
          <h2 class="text-lg font-semibold">No items yet</h2>
          <p>Add the first thing you keep in stock.</p>
        </header>
        <a href="/items/new" class="btn">
          Add item
        </a>
      </section>
    );
  }
  return (
    <section class="empty py-12">
      <header>
        <h2 class="text-lg font-semibold">No items found</h2>
        <p>{d.filtered ? "No item matches the search and filters." : "This tab has no items."}</p>
      </header>
      {d.filtered ? (
        <a
          href={d.clearHref}
          class="btn"
          data-variant="outline"
          hx-get={d.clearHref}
          hx-target="#main"
          hx-push-url="true"
        >
          Clear filters
        </a>
      ) : null}
    </section>
  );
}

const rowForm = (id: number, action: string) => ({
  method: "post" as const,
  action: itemAction(id, action),
  "hx-post": itemAction(id, action),
  "hx-target": rowTarget(id),
  "hx-swap": "outerHTML",
});

/** One item in the list. It is also the response to a count change. */
export function Row({ item: it, msg }: { item: Item; msg: string }) {
  const queue = "closest ul:queue all";
  return (
    <li
      id={rowId(it.id)}
      class="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-3 text-card-foreground"
    >
      <div class="min-w-0 flex-1">
        <a href={itemUrl(it.id)} class="block truncate font-medium">
          {it.name}
        </a>
        <p class="truncate text-sm text-muted-foreground">{orDash(it.locationName)}</p>
        {msg !== "" ? (
          <p class="text-sm text-destructive" role="alert">
            {msg}
          </p>
        ) : null}
      </div>
      <div class="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <form {...rowForm(it.id, "list")} hx-sync={queue}>
          <input type="hidden" name="on" value={onValue(!it.onList)} />
          <button
            type="submit"
            data-variant="outline"
            data-size="icon-lg"
            aria-pressed={boolStr(it.onList)}
            class={
              it.onList
                ? "btn size-12 border-orange-500 bg-orange-500 text-white hover:bg-orange-600 dark:border-orange-500 dark:bg-orange-500 dark:hover:bg-orange-600"
                : "btn size-12 text-muted-foreground"
            }
            aria-label={
              it.onList
                ? `Take ${it.name} off the shopping list`
                : `Add ${it.name} to the shopping list`
            }
            title={
              it.onList ? "On the shopping list. Tap to take it off." : "Add to the shopping list"
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-6"
              aria-hidden="true"
            >
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="18" cy="20" r="1.5" />
              <path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.8L21 7H6" />
              {it.onList ? <path d="m10.5 11 2 2 4-4" /> : <path d="M13.5 8.5v5M11 11h5" />}
            </svg>
          </button>
        </form>
        <form {...rowForm(it.id, "adjust")} hx-sync={queue}>
          <input type="hidden" name="delta" value="-1" />
          <button
            type="submit"
            class="btn size-12 text-xl"
            data-variant="outline"
            data-size="icon-lg"
            aria-label={`Take one ${it.name}`}
            disabled={it.count === 0}
          >
            −
          </button>
        </form>
        <form {...rowForm(it.id, "count")} hx-trigger="submit, change">
          <label class="relative block">
            <input
              type="number"
              name="count"
              value={String(it.count)}
              min="0"
              step="1"
              inputmode="numeric"
              aria-label={`Count of ${it.name}, in ${it.unit}`}
              onfocus="this.select()"
              class="input count-input h-12 w-16 pb-3.5 text-center text-lg leading-none font-semibold tabular-nums"
            />
            <span
              class="pointer-events-none absolute inset-x-1 bottom-1 truncate text-center text-[10px] leading-3 text-muted-foreground"
              aria-hidden="true"
            >
              {it.unit}
            </span>
          </label>
        </form>
        <form {...rowForm(it.id, "adjust")} hx-sync={queue}>
          <input type="hidden" name="delta" value="1" />
          <button
            type="submit"
            class="btn size-12 text-xl"
            data-size="icon-lg"
            aria-label={`Add one ${it.name}`}
          >
            +
          </button>
        </form>
      </div>
    </li>
  );
}
