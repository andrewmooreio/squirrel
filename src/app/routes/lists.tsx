import type { Context, Hono } from "hono";
import type { ListKind } from "../../db/types";
import { emptyLists, Lists, type ListsData } from "../../views/lists";
import { DuplicateError, ValidationError } from "../errors";
import { type Deps, notFound, page, pathIdOf, readForm, render } from "../http";
import { isListKind } from "../store";

/** Turns a store error into text for the user. It returns "" for errors that are not the user's doing. */
function listError(err: unknown): string {
  if (err instanceof ValidationError) return err.fields.name ?? "";
  if (err instanceof DuplicateError) return "This name is already in the list.";
  return "";
}

export function listRoutes(app: Hono, d: Deps) {
  const kindOf = (c: Context): ListKind | null => {
    const k = c.req.param("kind") ?? "";
    return isListKind(k) ? k : null;
  };

  const renderLists = async (c: Context, data: ListsData, status: number) => {
    const values = await d.store.lists(data.kind);
    return render(
      c,
      status,
      <Lists page={page(d, "Manage lists", "lists")} data={{ ...data, values }} />,
    );
  };

  app.get("/lists", (c) => c.redirect("/lists/categories", 303));

  app.get("/lists/:kind", async (c) => {
    const kind = kindOf(c);
    if (!kind) return notFound(c, d);
    return renderLists(c, emptyLists(kind), 200);
  });

  app.post("/lists/:kind", async (c) => {
    const kind = kindOf(c);
    if (!kind) return notFound(c, d);
    const name = (await readForm(c)).name ?? "";
    try {
      await d.store.createListValue(kind, name);
      return c.redirect(`/lists/${kind}`, 303);
    } catch (err) {
      const msg = listError(err);
      if (!msg) throw err;
      return renderLists(c, { ...emptyLists(kind), error: msg, newName: name }, 422);
    }
  });

  app.post("/lists/:kind/:id", async (c) => {
    const kind = kindOf(c);
    if (!kind) return notFound(c, d);
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    try {
      await d.store.renameListValue(kind, id, (await readForm(c)).name ?? "");
      return c.redirect(`/lists/${kind}`, 303);
    } catch (err) {
      const msg = listError(err);
      if (!msg) throw err;
      return renderLists(c, { ...emptyLists(kind), errorId: id, errorText: msg }, 422);
    }
  });

  app.post("/lists/:kind/:id/delete", async (c) => {
    const kind = kindOf(c);
    if (!kind) return notFound(c, d);
    const id = pathIdOf(c, "id");
    if (id === null) return notFound(c, d);
    await d.store.deleteListValue(kind, id);
    return c.redirect(`/lists/${kind}`, 303);
  });
}
