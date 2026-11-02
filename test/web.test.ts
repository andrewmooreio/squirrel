// The HTTP seam. Each test sends a Request to the app and checks the Response.
import { describe, expect, it } from "vitest";
import { contains, htmx, lacks, newApp, type Resp, wantRedirect, wantStatus } from "./support/app";

describe("health, version and assets", () => {
  it("answers /healthz with ok, and 503 when the database fails", async () => {
    const a = await newApp();
    const ok = await a.get("/healthz");
    wantStatus(ok, 200);
    expect(ok.body).toBe("ok\n");
    expect(ok.headers.get("Cache-Control")).toBe("no-store");

    a.driver.query = async () => {
      throw new Error("database is down");
    };
    const down = await a.get("/healthz");
    wantStatus(down, 503);
    expect(down.body).toBe("database unreachable\n");
  });

  it("shows the version in the footer", async () => {
    const a = await newApp("9.9.9");
    for (const path of ["/", "/lists/categories", "/nope"]) {
      contains(await a.get(path), "Squirrel v9.9.9");
    }
    // Builds that are not a release keep their name as it is.
    for (const v of ["dev", "edge-abc1234"]) {
      const r = await (await newApp(v)).get("/");
      contains(r, `Squirrel ${v}`);
      lacks(r, `Squirrel v${v}`);
    }
  });

  it("serves the manifest", async () => {
    const r = await (await newApp()).get("/manifest.webmanifest");
    wantStatus(r, 200);
    contains(r, '"name": "Squirrel"', "icon-512.png", "#f97316");
    expect(r.headers.get("Content-Type")).toContain("manifest");
  });

  it("links the stylesheet and scripts with a content hash", async () => {
    const r = await (await newApp()).get("/");
    expect(r.body).toMatch(/href="\/static\/app\.css\?v=[0-9a-f]{10}"/);
    expect(r.body).toMatch(/src="\/static\/app\.js\?v=[0-9a-f]{10}"/);
    expect(r.body).toMatch(/src="\/static\/vendor\/htmx\.min\.js\?v=[0-9a-f]{10}"/);
  });
});

describe("home page", () => {
  it("guides a first-time user to the lists", async () => {
    const a = await newApp();
    const r = await a.get("/");
    wantStatus(r, 200);
    contains(r, "Welcome to Squirrel", "category", "location", "store", "Set up lists");
    lacks(r, ">Add item<");
    wantRedirect(await a.get("/items/new"), "/lists/categories");

    // Once all three lists have a value the empty state offers to add an item.
    await a.seed();
    contains(await a.get("/"), "No items yet", ">Add item<");
    wantStatus(await a.get("/items/new"), 200);
  });

  it("shows tabs, and Uncategorised only when needed", async () => {
    const a = await newApp();
    const { cat: food, loc, shop } = await a.seed();
    const tools = await a.store.createListValue("categories", "Tools");
    await a.item("Tomatoes", 4, food, loc, shop);
    await a.item("Hammer", 1, tools, loc, shop);

    const all = await a.get("/");
    contains(all, "Tomatoes", "Hammer", ">All<", ">Food<", ">Tools<");
    lacks(all, "Uncategorised");

    const foodTab = await a.get(`/?tab=${food}`);
    contains(foodTab, "Tomatoes");
    lacks(foodTab, "Hammer");

    // Deleting a category moves its items to the Uncategorised tab.
    await a.store.deleteListValue("categories", tools);
    contains(await a.get("/"), "Uncategorised", "Hammer");
    const none = await a.get("/?tab=none");
    contains(none, "Hammer");
    lacks(none, "Tomatoes");
  });

  it("searches and filters", async () => {
    const a = await newApp();
    const { cat: food, loc: garage, shop: costco } = await a.seed();
    const pantry = await a.store.createListValue("locations", "Pantry");
    const aldi = await a.store.createListValue("stores", "Aldi");
    await a.item("Tomatoes", 4, food, garage, costco);
    await a.item("Tomato paste", 2, food, pantry, aldi);
    await a.item("Rice", 3, food, pantry, costco);

    // Search spans categories and ignores the tab.
    let r = await a.get("/?tab=999&q=tomato");
    contains(r, "Tomatoes", "Tomato paste");
    lacks(r, "Rice");

    lacks(await a.get(`/?loc=${pantry}`), "Tomatoes");
    lacks(await a.get(`/?store=${costco}`), "Tomato paste");

    r = await a.get(`/?q=tomato&loc=${pantry}&store=${aldi}`);
    contains(r, "Tomato paste");
    lacks(r, "Tomatoes", "Rice");

    contains(await a.get("/?q=nothing"), "No items found", "Clear filters");

    // A search over a non-All tab still searches everything.
    const tools = await a.store.createListValue("categories", "Tools");
    contains(await a.get(`/?tab=${tools}&q=rice`), "Rice");

    // LIKE wildcards in the search are plain characters.
    lacks(await a.get("/?q=%25"), "Rice");
  });

  it("sorts", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const apples = await a.item("Apples", 5, cat, loc, shop);
    await a.item("Beans", 1, cat, loc, shop);
    const cocoa = await a.item("Cocoa", 3, cat, loc, shop);
    // Timestamps have millisecond resolution, so pause between changes.
    // Cocoa changes last, then Apples, so Cocoa is the most recent.
    for (const id of [apples.id, cocoa.id]) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await a.store.adjust(id, 1);
    }

    const order = async (target: string, ...want: string[]) => {
      const r = await a.get(target);
      wantStatus(r, 200);
      const at = want.map((name) => r.body.indexOf(`>${name}</a>`));
      expect(
        at.every((i) => i >= 0),
        `${target}: a name is missing`,
      ).toBe(true);
      expect(
        [...at].sort((x, y) => x - y),
        `${target}: order`,
      ).toEqual(at);
    };
    await order("/", "Apples", "Beans", "Cocoa");
    await order("/?sort=name-desc", "Cocoa", "Beans", "Apples");
    await order("/?sort=count", "Beans", "Cocoa", "Apples");
    await order("/?sort=updated", "Cocoa", "Apples", "Beans");
    await order("/?sort=bogus", "Apples", "Beans", "Cocoa");

    // Tab links keep the sort.
    contains(await a.get("/?sort=count"), `href="/?sort=count&amp;tab=${cat}"`);

    // The select marks the current option.
    contains(await a.get("/?sort=count"), '<option value="count" selected="">');
    contains(await a.get("/"), '<option value="" selected="">Sort: A to Z</option>');
    contains(
      await a.get("/?sort=name-desc"),
      '<option value="name-desc" selected="">Sort: Z to A</option>',
    );
    contains(
      await a.get("/"),
      ">Sort: A to Z</option>",
      ">Sort: Z to A</option>",
      ">Sort: Lowest count first</option>",
      ">Sort: Recently changed</option>",
    );

    // A sort alone is not a filter. Clear filters keeps the sort.
    lacks(await a.get("/?sort=count"), "Clear filters");
    contains(
      await a.get("/?sort=count&q=nothing"),
      "No items found",
      "Clear filters",
      'href="/?sort=count"',
    );
  });

  it("answers HTMX with the right fragment", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    await a.item("Tomatoes", 4, cat, loc, shop);

    // Search updates only the stock region.
    let r = await a.get("/?q=tom", { ...htmx, "HX-Target": "div#stock" });
    wantStatus(r, 200);
    contains(r, 'id="stock"', "Tomatoes");
    lacks(r, "<html", 'id="filters"');
    expect(r.headers.get("Vary")).toBe("HX-Request, HX-Target");

    // A tab click swaps the search form and the stock region.
    r = await a.get(`/?tab=${cat}`, { ...htmx, "HX-Target": "div#main" });
    contains(r, 'id="filters"', 'id="stock"');
    lacks(r, "<html");

    contains(await a.get("/"), "<html");
    // A history restore needs the full page.
    contains(await a.get("/", { ...htmx, "HX-History-Restore-Request": "true" }), "<html");
  });
});

describe("count changes", () => {
  it("adjusts by one", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 1, cat, loc, shop);
    const path = `/items/${it.id}/adjust`;

    let r = await a.post(path, { delta: "1" }, htmx);
    wantStatus(r, 200);
    contains(r, `id="item-${it.id}"`, 'value="2"');
    lacks(r, "<html");

    contains(await a.post(path, { delta: "-1" }, htmx), 'value="1"');
    r = await a.post(path, { delta: "-1" }, htmx);
    contains(r, 'value="0"');
    // At zero the minus button is disabled.
    expect(r.body).toMatch(/value="-1".{0,300}disabled/s);

    // A forced −1 at zero changes nothing and tells the user.
    r = await a.post(path, { delta: "-1" }, htmx);
    wantStatus(r, 200);
    contains(r, 'value="0"', "cannot go below 0");
    lacks(r, "HX-Refresh");

    wantStatus(await a.post(path, { delta: "5" }, htmx), 400);
    wantStatus(await a.post(path, { delta: "abc" }, htmx), 400);
    wantStatus(await a.post("/items/9999/adjust", { delta: "1" }, htmx), 404);

    // Without HTMX the action redirects back.
    wantRedirect(
      await a.post(path, { delta: "1" }, { Referer: "http://example.com/?tab=3" }),
      "/?tab=3",
    );
    wantRedirect(await a.post(path, { delta: "1" }), `/items/${it.id}`);
    // A Referer on another host is not followed.
    wantRedirect(
      await a.post(path, { delta: "1" }, { Referer: "http://evil.example/x" }),
      `/items/${it.id}`,
    );

    expect((await a.store.getItem(it.id)).count).toBe(3);
    // A plain post at zero gives an error page.
    const zero = await a.item("Zero", 0, cat, loc, shop);
    wantStatus(await a.post(`/items/${zero.id}/adjust`, { delta: "-1" }), 400);
  });

  it("asks HTMX to refresh the item page after a count change", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 1, cat, loc, shop);
    const r = await a.post(
      `/items/${it.id}/adjust`,
      { delta: "1" },
      { ...htmx, "HX-Current-URL": `http://example.com/items/${it.id}` },
    );
    expect(r.headers.get("HX-Refresh")).toBe("true");
    const home = await a.post(
      `/items/${it.id}/adjust`,
      { delta: "1" },
      { ...htmx, "HX-Current-URL": "http://example.com/" },
    );
    expect(home.headers.get("HX-Refresh")).toBeNull();
  });

  it("sets an exact count", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 1, cat, loc, shop);
    const path = `/items/${it.id}/count`;

    contains(await a.post(path, { count: "24" }, htmx), 'value="24"');

    for (const bad of ["-3", "1.5", "abc", ""]) {
      const r = await a.post(path, { count: bad }, htmx);
      wantStatus(r, 200);
      contains(r, "whole number", 'value="24"');
    }
    wantStatus(await a.post(path, { count: "-3" }), 400);

    const hist = await a.store.history(it.id, 10);
    expect(hist[0]?.delta).toBe(23);
  });
});

describe("items", () => {
  it("creates an item", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const lists = { category_id: String(cat), location_id: String(loc), store_id: String(shop) };

    wantRedirect(
      await a.post("/items", { name: "Tomatoes", count: "6", notes: "Tins", ...lists }),
      "/",
    );
    contains(await a.get("/"), "Tomatoes", 'value="6"');

    // Duplicate names, including a different case, are refused.
    let r = await a.post("/items", { name: " tomatoes ", count: "6", ...lists });
    wantStatus(r, 422);
    contains(r, "already has this name", 'value=" tomatoes "');

    // Name, category, location and store are required. Notes are not.
    r = await a.post("/items", { count: "2" });
    wantStatus(r, 422);
    contains(r, "Enter a name", "Choose a category", "Choose a location", "Choose a store");

    r = await a.post("/items", { name: "X", count: "-1", ...lists });
    wantStatus(r, 422);
    contains(r, "whole number");

    // The count defaults to 0.
    wantRedirect(await a.post("/items", { name: "Rice", ...lists }), "/");
    contains(await a.get("/?q=rice"), 'value="0"');

    // A name over 100 characters is refused.
    r = await a.post("/items", { name: "x".repeat(101), ...lists });
    wantStatus(r, 422);
    contains(r, "Use 100 characters or fewer.");
  });

  it("gives each item a unit", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const lists = { category_id: String(cat), location_id: String(loc), store_id: String(shop) };

    // The add form offers the default unit.
    contains(await a.get("/items/new"), 'name="unit"', 'value="items"', '<option value="items"');

    // A blank unit means the default. A unit is trimmed and keeps its case.
    wantRedirect(await a.post("/items", { name: "Rice", count: "2", unit: "  ", ...lists }), "/");
    wantRedirect(
      await a.post("/items", { name: "Beans", count: "3", unit: " Tins ", ...lists }),
      "/",
    );
    wantRedirect(await a.post("/items", { name: "Soup", count: "1", unit: "Tins", ...lists }), "/");
    wantRedirect(await a.post("/items", { name: "Peas", count: "1", unit: "tins", ...lists }), "/");

    contains(
      await a.get("/"),
      'aria-label="Count of Rice, in items"',
      'aria-label="Count of Beans, in Tins"',
      ">Tins</span>",
    );

    // A unit over 20 characters is refused.
    const r = await a.post("/items", { name: "Oil", unit: "x".repeat(21), ...lists });
    wantStatus(r, 422);
    contains(r, "Use 20 characters or fewer.");

    // Suggestions list each unit once, in its most used spelling, most used first.
    const form = (await a.get("/items/new")).body;
    const suggestions = [...form.matchAll(/<option value="([^"]*)"><\/option>/g)].map((m) => m[1]);
    expect(suggestions).toEqual(["Tins", "items"]);

    // The edit form changes the unit but not the count.
    const beans = (await a.store.listItems({ search: "Beans" }))[0];
    const path = `/items/${beans?.id}`;
    contains(await a.get(`${path}/edit`), 'value="Tins"');
    wantRedirect(await a.post(path, { name: "Beans", unit: "kg", ...lists }), path);
    const got = await a.store.getItem(beans?.id ?? 0);
    expect([got.count, got.unit]).toEqual([3, "kg"]);

    // History shows the current unit. The API shows it too.
    contains(await a.get(path), '<span class="tabular-nums">3</span> kg');
    contains(await a.get(`/api/items/${beans?.id}`), '"unit":"kg"');
  });

  it("edits an item", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 3, cat, loc, shop);
    await a.store.deleteListValue("locations", loc);
    const newLoc = await a.store.createListValue("locations", "Pantry");
    const path = `/items/${it.id}`;

    // A blank field must be filled in before the edit saves.
    wantStatus(await a.get(`${path}/edit`), 200);
    const r = await a.post(path, {
      name: "Tomatoes",
      category_id: String(cat),
      store_id: String(shop),
    });
    wantStatus(r, 422);
    contains(r, "Choose a location");

    wantRedirect(
      await a.post(path, {
        name: "Plum tomatoes",
        notes: "Tins",
        category_id: String(cat),
        location_id: String(newLoc),
        store_id: String(shop),
      }),
      path,
    );
    contains(await a.get(path), "Plum tomatoes", "Pantry", "Tins");

    // Editing fields does not change the count or record history.
    expect((await a.store.getItem(it.id)).count).toBe(3);
    expect(await a.store.history(it.id, 10)).toHaveLength(1); // the starting count only
    wantStatus(await a.get("/items/9999/edit"), 404);
  });

  it("shows the history and undoes the newest change", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 0, cat, loc, shop);
    const path = `/items/${it.id}`;

    contains(await a.get(path), "No changes yet");
    await a.post(`${path}/adjust`, { delta: "1" });
    await a.post(`${path}/adjust`, { delta: "1" });

    const r = await a.get(path);
    contains(r, "History", "+1", "Undo");
    expect(r.body.split(">Undo<")).toHaveLength(2); // the newest change only

    wantRedirect(await a.post(`${path}/undo`), path);
    expect((await a.store.getItem(it.id)).count).toBe(1);
    wantRedirect(await a.post(`${path}/undo`), path);
    wantStatus(await a.post(`${path}/undo`), 404); // nothing left to undo
  });

  it("refuses an undo that makes the count negative", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Rice", 5, cat, loc, shop);
    await a.driver.batch([{ sql: "UPDATE items SET count = 3 WHERE id = ?", params: [it.id] }]);
    const r = await a.post(`/items/${it.id}/undo`);
    wantStatus(r, 409);
    contains(r, "Undo would make the count negative");
  });

  it("deletes an item after a confirm dialog", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 2, cat, loc, shop);
    const path = `/items/${it.id}`;

    contains(await a.get(path), "<dialog", "Delete Tomatoes?", "its history");

    wantRedirect(await a.post(`${path}/delete`), "/");
    wantStatus(await a.get(path), 404);
    lacks(await a.get("/"), "Tomatoes");
    wantStatus(await a.post(`${path}/delete`), 404);
  });

  it("shows a dash for a deleted list value", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 1, cat, loc, shop);
    await a.store.deleteListValue("locations", loc);
    contains(await a.get("/"), "—");
    contains(await a.get(`/items/${it.id}`), "—");
  });
});

describe("lists", () => {
  it("adds, renames and deletes list values", async () => {
    const a = await newApp();

    wantRedirect(await a.get("/lists"), "/lists/categories");
    const r = await a.get("/lists/categories");
    wantStatus(r, 200);
    contains(r, "Categories", "Locations", "Stores", "No Categories yet");
    wantStatus(await a.get("/lists/colours"), 404);

    wantRedirect(await a.post("/lists/categories", { name: "Food" }), "/lists/categories");
    contains(await a.get("/lists/categories"), "Food", "0 items");

    // Duplicates (any case) and blank names are refused.
    const dup = await a.post("/lists/categories", { name: " FOOD " });
    wantStatus(dup, 422);
    contains(dup, "already in the list");
    wantStatus(await a.post("/lists/categories", { name: "  " }), 422);

    // Each list is separate.
    wantRedirect(await a.post("/lists/locations", { name: "Food" }), "/lists/locations");

    const catId = (await a.store.lists("categories"))[0]?.id ?? 0;
    wantRedirect(
      await a.post(`/lists/categories/${catId}`, { name: "Pantry" }),
      "/lists/categories",
    );
    contains(await a.get("/lists/categories"), "Pantry");
    const renamed = await a.post(`/lists/categories/${catId}`, { name: "" });
    wantStatus(renamed, 422);
    contains(renamed, "Enter a name.");

    const loc = await a.store.createListValue("locations", "Garage");
    const shop = await a.store.createListValue("stores", "Costco");
    await a.item("Tomatoes", 1, catId, loc, shop);
    await a.item("Beans", 1, catId, loc, shop);

    // The delete dialog shows how many items use the value.
    contains(await a.get("/lists/categories"), "2 items", "2 items use this category");

    // Deleting a value that is in use is allowed. The items stay, blank.
    wantRedirect(await a.post(`/lists/categories/${catId}/delete`), "/lists/categories");
    contains(await a.get("/?tab=none"), "Tomatoes", "Beans");
    wantStatus(await a.post(`/lists/categories/${catId}/delete`), 404);
  });
});

describe("cross-origin protection", () => {
  it("refuses a change that comes from another website", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 2, cat, loc, shop);
    const path = `/items/${it.id}`;

    const r = await a.post(`${path}/delete`, undefined, { "Sec-Fetch-Site": "cross-site" });
    wantStatus(r, 403);
    contains(r, "another website");
    wantStatus(await a.post(`${path}/delete`, undefined, { Origin: "http://evil.example" }), 403);
    wantStatus(await a.get(path), 200);

    // Reads from other sites work. So do our own posts.
    wantStatus(await a.get(path, { "Sec-Fetch-Site": "cross-site" }), 200);
    wantRedirect(
      await a.post(`${path}/delete`, undefined, { "Sec-Fetch-Site": "same-origin" }),
      "/",
    );
  });

  it("allows an Origin that matches the Host", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Tomatoes", 2, cat, loc, shop);
    wantRedirect(
      await a.post(`/items/${it.id}/delete`, undefined, { Origin: "http://example.com" }),
      "/",
    );
  });
});

describe("unknown routes", () => {
  it("answers with an HTML 404", async () => {
    const a = await newApp();
    const r = await a.get("/nope");
    wantStatus(r, 404);
    contains(r, "<html");
    wantStatus(await a.get("/items/abc"), 404);
    wantStatus(await a.get("/items/0"), 404);
    wantStatus(await a.post("/"), 404);
  });

  it("answers with a 500 page when the database fails", async () => {
    const a = await newApp();
    a.driver.query = async () => {
      throw new Error("boom");
    };
    const r = await a.get("/");
    wantStatus(r, 500);
    contains(r, "Something went wrong");
    const api = await a.get("/api/items");
    wantStatus(api, 500);
    expect(JSON.parse(api.body)).toEqual({ error: "Something went wrong." });
  });
});

describe("shopping list", () => {
  it("toggles items and groups them by store", async () => {
    const a = await newApp();
    const { cat, loc, shop: costco } = await a.seed();
    contains(await a.get("/shopping"), "Nothing to buy", "Tap the cart", "Back to the list");

    const aldi = await a.store.createListValue("stores", "Aldi");
    const rice = await a.item("Rice", 0, cat, loc, costco);
    const beans = await a.item("Beans", 2, cat, loc, costco);
    const milk = await a.item("Milk", 5, cat, loc, aldi);
    await a.item("Salt", 0, cat, loc, costco);

    // An item at 0 does not join the list by itself.
    contains(await a.get("/shopping"), "Nothing to buy");

    // A plain post goes back. An HTMX post swaps the row.
    wantRedirect(
      await a.post(`/items/${rice.id}/list`, { on: "1" }, { Referer: "http://example.com/" }),
      "/",
    );
    wantRedirect(await a.post(`/items/${beans.id}/list`, { on: "1" }), `/items/${beans.id}`);
    let r = await a.post(`/items/${milk.id}/list`, { on: "1" }, htmx);
    wantStatus(r, 200);
    contains(
      r,
      'aria-pressed="true"',
      "Take Milk off the shopping list",
      'title="On the shopping list. Tap to take it off."',
    );
    lacks(r, "<html");

    // The button for an item off the list offers to add it.
    r = await a.post(`/items/${milk.id}/list`, { on: "0" }, htmx);
    contains(
      r,
      'aria-pressed="false"',
      "Add Milk to the shopping list",
      'title="Add to the shopping list"',
    );
    wantStatus(await a.post(`/items/${milk.id}/list`, { on: "1" }, htmx), 200);

    r = await a.get("/shopping");
    wantStatus(r, 200);
    contains(r, "Shopping list", "Rice", "Beans", "Milk");
    lacks(r, "Salt", "Nothing to buy");
    const at = (body: string, s: string) => {
      const i = body.indexOf(s);
      expect(i, `body does not contain ${s}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const hAldi = at(r.body, ">Aldi</h2>");
    const hCostco = at(r.body, ">Costco</h2>");
    expect(hAldi).toBeLessThan(hCostco);
    const m = at(r.body, "Take one Milk");
    expect(m > hAldi && m < hCostco, "Milk is under Aldi").toBe(true);
    expect(at(r.body, "Take one Rice")).toBeGreaterThan(hCostco);

    // Items of a deleted store move to a last group.
    await a.store.deleteListValue("stores", aldi);
    r = await a.get("/shopping");
    lacks(r, ">Aldi</h2>");
    const hNone = at(r.body, ">No store</h2>");
    expect(hNone).toBeGreaterThan(at(r.body, ">Costco</h2>"));
    expect(at(r.body, "Take one Milk")).toBeGreaterThan(hNone);

    // Count changes and undo leave the flag alone.
    const ri = `/items/${rice.id}`;
    wantRedirect(
      await a.post(`${ri}/adjust`, { delta: "1" }, { Referer: "http://example.com/shopping" }),
      "/shopping",
    );
    contains(await a.get("/shopping"), "Count of Rice");
    wantStatus(await a.post(`${ri}/adjust`, { delta: "-1" }), 303);
    wantStatus(await a.post(`${ri}/count`, { count: "7" }), 303);
    wantStatus(await a.post(`${ri}/undo`), 303);
    contains(await a.get("/shopping"), "Take Rice off the shopping list");
    contains(await a.get(ri), 'aria-pressed="true"');

    // Taking an item off removes it on the next load.
    r = await a.post(`${ri}/list`, { on: "0" }, htmx);
    wantStatus(r, 200);
    contains(r, 'aria-pressed="false"', "Add Rice to the shopping list");
    lacks(await a.get("/shopping"), "Rice");

    // Bad input.
    for (const form of [{ on: "yes" }, { on: "" }, {} as Record<string, string>]) {
      wantStatus(await a.post(`${ri}/list`, form), 400);
    }
    wantStatus(await a.post("/items/9999/list", { on: "1" }), 404);
    wantStatus(await a.post("/items/abc/list", { on: "1" }), 404);

    // Other sites cannot change the list.
    wantStatus(await a.post(`${ri}/list`, { on: "1" }, { "Sec-Fetch-Site": "cross-site" }), 403);
    wantStatus(await a.post(`${ri}/list`, { on: "1" }, { Origin: "http://evil.example" }), 403);
    lacks(await a.get("/shopping"), "Rice");

    // The flag is not a count change. It leaves the history and updated_at alone.
    const before = await a.store.getItem(rice.id);
    const histBefore = await a.store.history(rice.id, 10);
    wantStatus(await a.post(`${ri}/list`, { on: "1" }), 303);
    const after = await a.store.getItem(rice.id);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(await a.store.history(rice.id, 10)).toHaveLength(histBefore.length);

    // The header links to the page and marks it when current.
    contains(await a.get("/"), 'href="/shopping"');
    expect((await a.get("/shopping")).body).toMatch(
      /href="\/shopping"[^>]*data-variant="secondary"/,
    );
  });
});

describe("JSON API", () => {
  const names = (r: Resp) => {
    wantJson(r, 200);
    return (JSON.parse(r.body) as { items: { name: string }[] }).items.map((i) => i.name);
  };
  const wantJson = (r: Resp, status: number) => {
    wantStatus(r, status);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  };
  const wantApiError = (r: Resp, status: number, msg: string) => {
    wantJson(r, status);
    expect(JSON.parse(r.body)).toEqual({ error: msg });
    lacks(r, "<html");
  };

  it("lists items with filters", async () => {
    const a = await newApp();
    contains(await a.get("/api/items"), '"items":[]');

    const { cat: food, loc: garage, shop: costco } = await a.seed();
    const tools = await a.store.createListValue("categories", "Tools");
    const shed = await a.store.createListValue("locations", "Shed");
    const aldi = await a.store.createListValue("stores", "Aldi");
    await a.item("Cocoa", 5, food, garage, costco);
    await a.item("Apples", 9, food, shed, aldi);
    await a.item("Beans", 1, tools, garage, costco);
    await a.item("Dust", 2, tools, shed, aldi);

    const r = await a.get("/api/items");
    wantJson(r, 200);
    const out = JSON.parse(r.body) as { items: Record<string, unknown>[] };
    expect(out.items).toHaveLength(4);
    const apples = out.items[0] ?? {};
    expect(Object.keys(apples)).toEqual([
      "id",
      "name",
      "count",
      "unit",
      "category",
      "location",
      "store",
      "notes",
      "on_list",
      "updated_at",
    ]);
    expect(apples).toMatchObject({
      name: "Apples",
      count: 9,
      unit: "items",
      category: "Food",
      location: "Shed",
      store: "Aldi",
      on_list: false,
    });
    expect(String(apples.updated_at)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/);

    const check = async (target: string, ...want: string[]) =>
      expect(names(await a.get(target)), target).toEqual(want);
    await check("/api/items?q=coc", "Cocoa");
    await check(`/api/items?category=${food}`, "Apples", "Cocoa");
    await check("/api/items?category=none");
    await check(`/api/items?location=${garage}`, "Beans", "Cocoa");
    await check(`/api/items?store=${costco}`, "Beans", "Cocoa");
    await check(`/api/items?category=${tools}&location=${shed}`, "Dust");
    await check("/api/items?sort=count", "Beans", "Dust", "Cocoa", "Apples");
    await check("/api/items?sort=name-desc", "Dust", "Cocoa", "Beans", "Apples");
    await check("/api/items?sort=bogus", "Apples", "Beans", "Cocoa", "Dust");

    // The shopping list flag.
    const cocoa = out.items[2] as { id: number };
    await a.store.setOnList(cocoa.id, true);
    await check("/api/items?on_list=1", "Cocoa");
    await check("/api/items?on_list=TRUE", "Cocoa");
    await check("/api/items?on_list=0", "Apples", "Beans", "Dust");
    await check("/api/items?on_list=False", "Apples", "Beans", "Dust");
    await check("/api/items?on_list=", "Apples", "Beans", "Cocoa", "Dust");
    contains(await a.get("/api/items?on_list=1"), '"on_list":true');
    wantApiError(await a.get("/api/items?on_list=bogus"), 400, "Invalid on_list.");

    for (const bad of ["category=abc", "category=-1", "location=x", "store=1.5"]) {
      wantJson(await a.get(`/api/items?${bad}`), 400);
    }
    wantApiError(await a.get("/api/items?category=abc"), 400, "Invalid category.");
    wantApiError(await a.get("/api/items?location=x"), 400, "Invalid location.");
    wantApiError(await a.get("/api/items?store=x"), 400, "Invalid store.");

    // A deleted list value leaves the field null.
    await a.store.deleteListValue("categories", tools);
    contains(await a.get("/api/items?q=beans"), '"category":null');
    await check("/api/items?category=none", "Beans", "Dust");
  });

  it("returns one item, 404 and 405", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    const it = await a.item("Cocoa", 5, cat, loc, shop);

    const r = await a.get(`/api/items/${it.id}`);
    wantJson(r, 200);
    expect(JSON.parse(r.body)).toMatchObject({
      id: it.id,
      name: "Cocoa",
      count: 5,
      category: "Food",
      location: "Garage",
      store: "Costco",
    });

    wantApiError(await a.get("/api/items/9999"), 404, "Not found.");
    wantApiError(await a.get("/api/items/abc"), 404, "Not found.");
    wantApiError(await a.get("/api/nothing"), 404, "Not found.");

    for (const target of ["/api/items", `/api/items/${it.id}`]) {
      const res = await a.post(target);
      wantApiError(res, 405, "Method not allowed.");
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
    }
  });

  it("answers HEAD like GET with no body", async () => {
    const a = await newApp();
    const r = await a.request("/api/items", { method: "HEAD" });
    wantStatus(r, 200);
    expect(r.body).toBe("");
  });
});

describe("export and import", () => {
  it("exports the items as CSV", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    await a.item("Rice", 3, cat, loc, shop);
    const nasty = 'Line one, with a comma\nand "quotes"';
    const beans = await a.item("Beans", 0, cat, loc, shop);
    await a.store.updateItem(beans.id, {
      name: "Beans",
      categoryId: cat,
      locationId: loc,
      storeId: shop,
      notes: nasty,
    });

    const r = await a.get("/export.csv");
    wantStatus(r, 200);
    expect(r.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="squirrel-items-\d{4}-\d\d-\d\d\.csv"$/,
    );
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.body).toBe(
      'name,count,unit,category,location,store,notes\nBeans,0,items,Food,Garage,Costco,"Line one, with a comma\nand ""quotes"""\nRice,3,items,Food,Garage,Costco,\n',
    );
  });

  it("shows the transfer page", async () => {
    const a = await newApp();
    contains(
      await a.get("/transfer"),
      "Import and export",
      'href="/export.csv"',
      'action="/import"',
      'enctype="multipart/form-data"',
      'name="file"',
    );
    contains(await a.get("/lists/categories"), 'href="/transfer"');
  });

  it("imports a file and skips bad rows", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    await a.item("Rice", 1, cat, loc, shop);

    const file =
      "name,count,unit,category,location,store,notes\n" +
      "Beans,4, tins ,food,Garage,Aldi,Tinned\n" + // line 2: new item, reuses Food, new store
      "rice,2,,Food,Garage,Costco,\n" + // line 3: exists
      "Flour,,,Food,Garage,Aldi,\n" + // line 4: blank count is 0, blank unit is items
      "BEANS,1,,Food,Garage,Aldi,\n" + // line 5: repeats a name in the file
      "Salt,1,,,Garage,Aldi,\n" + // line 6: no category
      "Pepper,abc,,Food,Garage,Aldi,\n" + // line 7: bad count
      ",,,,,,\n" + // line 8: blank row, ignored
      "Oil,2,,Food,Shed,Aldi,\n" + // line 9: new location
      `Sugar,1,${"x".repeat(21)},Food,Garage,Aldi,\n`; // line 10: unit too long
    const r = await a.upload("/import", "file", "items.csv", file);
    wantStatus(r, 200);
    contains(
      r,
      "Import done",
      "Added 3 items.",
      "Skipped 5 rows.",
      "Line 3, rice: An item with this name exists. Squirrel did not change it.",
      "Line 5, BEANS: An item with this name exists. Squirrel did not change it.",
      "Line 6, Salt: Enter a category.",
      "Line 7, Pepper: Enter a whole number of 0 or more.",
      "Line 10, Sugar: Use 20 characters or fewer.",
      "Back to the list",
      "Import another file",
    );

    const home = await a.get("/");
    contains(home, "Beans", "Flour", "Oil");
    lacks(home, "Salt", "Pepper");
    contains(await a.get("/lists/stores"), "Aldi");
    contains(await a.get("/lists/locations"), "Shed");
    expect(await a.store.lists("categories")).toHaveLength(1);

    const beans = (await a.store.listItems({ search: "Beans" }))[0];
    expect(beans).toMatchObject({ count: 4, unit: "tins", notes: "Tinned" });
    contains(await a.get(`/items/${beans?.id}`), "History", "+4");
    const flour = (await a.store.listItems({ search: "Flour" }))[0];
    expect(flour?.unit).toBe("items");
    expect(await a.store.history(flour?.id ?? 0, 10)).toHaveLength(0);
    const rice = await a.store.listItems({ search: "rice" });
    expect(rice).toHaveLength(1);
    expect(rice[0]?.count).toBe(1);
  });

  it("uses singular wording", async () => {
    const a = await newApp();
    const r = await a.upload(
      "/import",
      "file",
      "items.csv",
      "name,category,location,store\nRice,A,B,C\n",
    );
    wantStatus(r, 200);
    contains(r, "Added 1 item.");
    lacks(r, "Skipped");
  });

  it("reports the start line of a record with a quoted new line", async () => {
    const a = await newApp();
    const file = 'name,count,category,location,store,notes\nRice,1,A,B,C,"two\nlines"\n,1,A,B,C,\n';
    const r = await a.upload("/import", "file", "items.csv", file);
    wantStatus(r, 200);
    contains(r, "Line 4: Enter a name.");
  });

  it("refuses a file with a missing column", async () => {
    const a = await newApp();
    const r = await a.upload("/import", "file", "items.csv", "name,category,location\nRice,A,B\n");
    wantStatus(r, 422);
    contains(r, "The file needs these columns: name, category, location, store.");
    lacks(await a.get("/"), "Rice");
    expect(await a.store.listItems()).toHaveLength(0);
  });

  it("strips a BOM and matches headers in any order, case or spacing", async () => {
    const a = await newApp();
    const file = "\ufeff Store ,NAME,Location,Category,Extra,Count\nAldi,Rice,Garage,Food,x,5\n";
    const r = await a.upload("/import", "file", "items.csv", file);
    wantStatus(r, 200);
    contains(r, "Added 1 item.");
    const items = await a.store.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ count: 5, storeName: "Aldi", categoryName: "Food" });
  });

  it("refuses bad requests", async () => {
    const a = await newApp();
    let r = await a.upload("/import", "other", "items.csv", "name\n");
    wantStatus(r, 400);
    contains(r, "Choose a CSV file.");
    wantStatus(await a.post("/import", { x: "y" }), 400);
    r = await a.upload(
      "/import",
      "file",
      "items.csv",
      'name,category,location,store\nRice,"A,B,C\n',
    );
    wantStatus(r, 422);
    contains(r, "Squirrel cannot read this file. Check that it is a CSV file.");
    r = await a.upload("/import", "file", "items.csv", "x".repeat(2 << 20));
    wantStatus(r, 413);
    contains(r, "The file is too big. Use a file of 1 MB or less.");
  });

  it("imports a large file in few statements", async () => {
    const a = await newApp();
    const rows = Array.from(
      { length: 1500 },
      (_, i) => `Item ${i},${i % 3},,Cat ${i % 7},Loc,Shop,`,
    );
    const file = `name,count,unit,category,location,store,notes\n${rows.join("\n")}\n`;
    let statements = 0;
    const batch = a.driver.batch.bind(a.driver);
    a.driver.batch = async (s) => {
      statements += s.length;
      return batch(s);
    };
    const r = await a.upload("/import", "file", "items.csv", file);
    contains(r, "Added 1,500 items.".replace(",", ""));
    expect(statements).toBeLessThanOrEqual(10);
    expect(await a.store.lists("categories")).toHaveLength(7);
  });

  it("round-trips an export through an import", async () => {
    const a = await newApp();
    const { cat, loc, shop } = await a.seed();
    await a.item("Rice", 3, cat, loc, shop);
    const it = await a.item("Beans", 0, cat, loc, shop);
    await a.store.updateItem(it.id, {
      name: "Beans",
      categoryId: cat,
      locationId: loc,
      storeId: shop,
      notes: 'a, "b"\nc',
      unit: "tins",
    });
    const first = (await a.get("/export.csv")).body;

    const b = await newApp();
    const r = await b.upload("/import", "file", "items.csv", first);
    wantStatus(r, 200);
    contains(r, "Added 2 items.");
    expect((await b.get("/export.csv")).body).toBe(first);
  });
});
