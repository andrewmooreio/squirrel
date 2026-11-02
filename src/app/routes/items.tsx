import type { Context, Hono } from "hono";
import { Row } from "../../views/home";
import { emptyForm, ItemForm, type ItemFormData, ItemPage } from "../../views/item";
import { BelowZeroError, DuplicateError, ValidationError } from "../errors";
import {
  backTo,
  type Deps,
  fragment,
  isHTMX,
  message,
  notFound,
  page,
  pathIdOf,
  readForm,
  render,
} from "../http";
import type { Item, ItemInput } from "../store";
import { atoi, COUNT_MESSAGE, DEFAULT_UNIT, parseCount, parseId } from "../validate";

const HISTORY_LEN = 10;
const itemPath = (id: number) => `/items/${id}`;

export function itemRoutes(app: Hono, d: Deps) {
  /** Loads the three lists and the unit suggestions for the item form. */
  const withLists = async (form: ItemFormData): Promise<ItemFormData> => {
    const [units, categories, locations, stores] = await Promise.all([
      d.store.units(),
      d.store.lists("categories"),
      d.store.lists("locations"),
      d.store.lists("stores"),
    ]);
    return { ...form, units, categories, locations, stores };
  };

  app.get("/items/new", async (c) => {
    const form = await withLists({ ...emptyForm(), unit: DEFAULT_UNIT });
    // An item needs one value from each list, so send the user to set them up.
    if (!form.categories.length || !form.locations.length || !form.stores.length) {
      return c.redirect("/lists/categories", 303);
    }
    return render(c, 200, <ItemForm page={page(d, "Add item")} data={form} />);
  });

  app.get("/items/:id/edit", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    const it = await d.store.getItem(id);
    const form = await withLists({
      ...emptyForm(),
      id: it.id,
      name: it.name,
      count: it.count,
      unit: it.unit,
      notes: it.notes,
      categoryId: it.categoryId,
      locationId: it.locationId,
      storeId: it.storeId,
    });
    return render(c, 200, <ItemForm page={page(d, `Edit ${it.name}`)} data={form} />);
  });

  /** Turns the posted form into form data and store input. */
  const readItemForm = async (c: Context, id: number) => {
    const f = await readForm(c);
    const errors: Record<string, string> = {};
    let count = 0;
    if (id === 0) {
      const raw = (f.count ?? "").trim();
      if (raw !== "") {
        const n = parseCount(raw);
        if (n === null) errors.count = COUNT_MESSAGE;
        else count = n;
      }
    }
    const input: ItemInput = {
      name: f.name ?? "",
      count,
      categoryId: parseId(f.category_id),
      locationId: parseId(f.location_id),
      storeId: parseId(f.store_id),
      notes: f.notes ?? "",
      unit: f.unit ?? "",
    };
    const form: ItemFormData = {
      ...emptyForm(),
      id,
      name: input.name,
      count,
      unit: input.unit ?? "",
      notes: input.notes ?? "",
      categoryId: input.categoryId,
      locationId: input.locationId,
      storeId: input.storeId,
    };
    return { form, input, errors };
  };

  /** Merges a store error into errors. It returns false if err is not a user error. */
  const formErrors = (errors: Record<string, string>, err: unknown): boolean => {
    if (err instanceof ValidationError) {
      Object.assign(errors, err.fields);
      return true;
    }
    if (err instanceof DuplicateError) {
      errors.name = "Another item already has this name.";
      return true;
    }
    return false;
  };

  const rerender = async (
    c: Context,
    form: ItemFormData,
    errors: Record<string, string>,
    title: string,
  ) => {
    const data = await withLists({ ...form, errors });
    return render(c, 422, <ItemForm page={page(d, title)} data={data} />);
  };

  app.post("/items", async (c) => {
    const { form, input, errors } = await readItemForm(c, 0);
    if (Object.keys(errors).length === 0) {
      try {
        await d.store.createItem(input);
        return c.redirect("/", 303);
      } catch (err) {
        if (!formErrors(errors, err)) throw err;
      }
    }
    return rerender(c, form, errors, "Add item");
  });

  const renderItemPage = async (c: Context, id: number, status: number, error: string) => {
    const item = await d.store.getItem(id);
    const history = await d.store.history(id, HISTORY_LEN);
    return render(
      c,
      status,
      <ItemPage page={page(d, item.name)} data={{ item, history, error }} />,
    );
  };

  app.get("/items/:id", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    return renderItemPage(c, id, 200, "");
  });

  app.post("/items/:id", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    const { form, input, errors } = await readItemForm(c, id);
    if (Object.keys(errors).length === 0) {
      try {
        await d.store.updateItem(id, input);
        return c.redirect(itemPath(id), 303);
      } catch (err) {
        if (!formErrors(errors, err)) throw err;
      }
    }
    return rerender(c, form, errors, "Edit item");
  });

  app.post("/items/:id/delete", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    await d.store.deleteItem(id);
    return c.redirect("/", 303);
  });

  /**
   * Answers a count change. On the item page the history also changed, so
   * HTMX reloads the page. Elsewhere it swaps the row.
   */
  const countDone = (c: Context, it: Item, msg: string) => {
    if (!isHTMX(c)) return backTo(c, itemPath(it.id));
    let current = "";
    try {
      current = new URL(c.req.header("HX-Current-URL") ?? "", "http://x").pathname;
    } catch {
      current = "";
    }
    if (current.startsWith("/items/") && msg === "") c.header("HX-Refresh", "true");
    return fragment(c, 200, <Row item={it} msg={msg} />);
  };

  /** Shows msg next to the item. HTMX gets the row back; a plain post gets an error page. */
  const countFailed = async (c: Context, id: number, msg: string) => {
    if (!isHTMX(c)) return message(c, d, 400, "Count not changed", msg);
    return countDone(c, await d.store.getItem(id), msg);
  };

  app.post("/items/:id/adjust", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    const delta = atoi((await readForm(c)).delta ?? "");
    if (delta !== 1 && delta !== -1) {
      return message(c, d, 400, "Bad request", "The change must be +1 or −1.");
    }
    try {
      return countDone(c, await d.store.adjust(id, delta), "");
    } catch (err) {
      if (err instanceof BelowZeroError) return countFailed(c, id, "The count cannot go below 0.");
      throw err;
    }
  });

  app.post("/items/:id/count", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    const n = parseCount((await readForm(c)).count ?? "");
    if (n === null) return countFailed(c, id, COUNT_MESSAGE);
    return countDone(c, await d.store.setCount(id, n), "");
  });

  // Adds an item to the shopping list or takes it off. HTMX swaps the row.
  app.post("/items/:id/list", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    const on = (await readForm(c)).on;
    if (on !== "0" && on !== "1") {
      return message(c, d, 400, "Bad request", "The shopping list value must be 1 or 0.");
    }
    const it = await d.store.setOnList(id, on === "1");
    if (!isHTMX(c)) return backTo(c, itemPath(id));
    return fragment(c, 200, <Row item={it} msg="" />);
  });

  app.post("/items/:id/undo", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    try {
      await d.store.undo(id);
      return c.redirect(itemPath(id), 303);
    } catch (err) {
      if (err instanceof BelowZeroError) {
        return renderItemPage(
          c,
          id,
          409,
          "Undo would make the count negative, so Squirrel left it as it is.",
        );
      }
      throw err;
    }
  });
}
