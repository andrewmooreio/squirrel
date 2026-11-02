import type { ListValue } from "../app/store";
import { LIST_KINDS, type ListKind } from "../db/types";
import type { Page } from "./helpers";
import {
  boolStr,
  dialogId,
  kindLabel,
  kindPlural,
  listUrl,
  listValueAction,
  plural,
} from "./helpers";
import { ConfirmDialog, openDialog } from "./item";
import { Layout } from "./layout";

export interface ListsData {
  kind: ListKind;
  values: ListValue[];
  /** A message for the add form. */
  error: string;
  /** The row with a rename error, and its message. */
  errorId: number;
  errorText: string;
  newName: string;
}

export const emptyLists = (kind: ListKind): ListsData => ({
  kind,
  values: [],
  error: "",
  errorId: 0,
  errorText: "",
  newName: "",
});

function deleteBody(kind: ListKind, v: ListValue): string {
  if (v.uses === 0) return `No items use this ${kindLabel(kind)}.`;
  return `${plural(v.uses, "item uses", "items use")} this ${kindLabel(kind)}. They stay in Squirrel with this field blank.`;
}

export function Lists({ page, data: d }: { page: Page; data: ListsData }) {
  return (
    <Layout page={page}>
      <div class="mx-auto grid max-w-xl gap-4">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-xl font-semibold">Manage lists</h1>
          <a href="/transfer" class="btn whitespace-nowrap" data-variant="outline" data-size="sm">
            Import and export
          </a>
        </div>
        <nav aria-label="Lists" class="tab-scroll">
          <div class="tabs">
            <div role="tablist" aria-orientation="horizontal" data-variant="line" class="min-w-max">
              {LIST_KINDS.map((k) => (
                <a
                  role="tab"
                  href={listUrl(k)}
                  aria-selected={boolStr(k === d.kind)}
                  class="h-11 px-4"
                >
                  {kindPlural(k)}
                </a>
              ))}
            </div>
          </div>
        </nav>
        <form method="post" action={listUrl(d.kind)} class="flex gap-2">
          <input
            type="text"
            name="name"
            value={d.newName}
            maxlength={100}
            required
            autocomplete="off"
            placeholder={`New ${kindLabel(d.kind)}`}
            aria-label={`New ${kindLabel(d.kind)} name`}
            class="input h-11 flex-1"
          />
          <button type="submit" class="btn h-11">
            Add
          </button>
        </form>
        {d.error !== "" ? (
          <p class="text-sm text-destructive" role="alert">
            {d.error}
          </p>
        ) : null}
        {d.values.length === 0 ? (
          <p class="text-sm text-muted-foreground">
            No {kindPlural(d.kind)} yet. Add the first one above.
          </p>
        ) : (
          <ul class="grid gap-2">
            {d.values.map((v) => (
              <ListRow data={d} value={v} />
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}

function ListRow({ data: d, value: v }: { data: ListsData; value: ListValue }) {
  return (
    <li class="grid gap-1 rounded-xl border bg-card p-3">
      <div class="flex flex-wrap items-center gap-2">
        <form
          method="post"
          action={listValueAction(d.kind, v.id)}
          class="flex min-w-full flex-1 gap-2 sm:min-w-0"
        >
          <input
            type="text"
            name="name"
            value={v.name}
            maxlength={100}
            required
            autocomplete="off"
            aria-label={`Rename ${v.name}`}
            class="input h-11 min-w-0 flex-1"
          />
          <button type="submit" class="btn h-11" data-variant="outline">
            Rename
          </button>
        </form>
        <span class="badge mr-auto" data-variant="secondary">
          {plural(v.uses, "item", "items")}
        </span>
        <button
          type="button"
          class="btn h-11"
          data-variant="destructive"
          aria-label={`Delete ${v.name}`}
          onclick={openDialog(dialogId(v.id))}
        >
          Delete
        </button>
      </div>
      {d.errorId === v.id && d.errorText !== "" ? (
        <p class="text-sm text-destructive" role="alert">
          {d.errorText}
        </p>
      ) : null}
      <ConfirmDialog
        id={dialogId(v.id)}
        title={`Delete ${v.name}?`}
        body={deleteBody(d.kind, v)}
        action={listValueAction(d.kind, v.id, "delete")}
      />
    </li>
  );
}
