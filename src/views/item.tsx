import type { Change, Item, ListValue } from "../app/store";
import type { Page } from "./helpers";
import {
  delta,
  fallbackTime,
  idStr,
  isSelected,
  itemAction,
  itemUrl,
  orDash,
  rfc3339,
} from "./helpers";
import { Row } from "./home";
import { Layout } from "./layout";

export interface ItemFormData {
  /** 0 for a new item. */
  id: number;
  name: string;
  count: number;
  unit: string;
  categoryId: number;
  locationId: number;
  storeId: number;
  notes: string;
  categories: ListValue[];
  locations: ListValue[];
  stores: ListValue[];
  /** The suggestions for the unit field. */
  units: string[];
  /** Maps a field name to its message. */
  errors: Record<string, string>;
}

export const emptyForm = (): ItemFormData => ({
  id: 0,
  name: "",
  count: 0,
  unit: "",
  categoryId: 0,
  locationId: 0,
  storeId: 0,
  notes: "",
  categories: [],
  locations: [],
  stores: [],
  units: [],
  errors: {},
});

const FieldError = ({ msg }: { msg?: string }) =>
  msg ? <p class="text-sm text-destructive">{msg}</p> : null;

export function ItemForm({ page, data: d }: { page: Page; data: ItemFormData }) {
  const action = d.id === 0 ? "/items" : itemUrl(d.id);
  const cancel = d.id === 0 ? "/" : itemUrl(d.id);
  return (
    <Layout page={page}>
      <div class="mx-auto grid max-w-xl gap-4">
        <h1 class="text-xl font-semibold">{d.id === 0 ? "Add item" : "Edit item"}</h1>
        <form method="post" action={action} class="form grid gap-5">
          {d.errors.form ? (
            <p class="text-sm text-destructive" role="alert">
              {d.errors.form}
            </p>
          ) : null}
          <div class="field">
            <label for="name" class="label">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={d.name}
              required
              maxlength={100}
              autocomplete="off"
              class="input h-11"
            />
            <FieldError msg={d.errors.name} />
          </div>
          {d.id === 0 ? (
            <div class="grid grid-cols-2 gap-3">
              <div class="field">
                <label for="count" class="label">
                  Starting count
                </label>
                <input
                  id="count"
                  name="count"
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  value={String(d.count)}
                  class="input h-11"
                />
                <FieldError msg={d.errors.count} />
              </div>
              <UnitField value={d.unit} units={d.units} msg={d.errors.unit} />
            </div>
          ) : (
            <UnitField value={d.unit} units={d.units} msg={d.errors.unit} />
          )}
          <SelectField
            name="category_id"
            label="Category"
            selected={d.categoryId}
            options={d.categories}
            msg={d.errors.category}
          />
          <SelectField
            name="location_id"
            label="Location"
            selected={d.locationId}
            options={d.locations}
            msg={d.errors.location}
          />
          <SelectField
            name="store_id"
            label="Store"
            selected={d.storeId}
            options={d.stores}
            msg={d.errors.store}
          />
          <div class="field">
            <label for="notes" class="label">
              Notes (optional)
            </label>
            <textarea id="notes" name="notes" rows={3} class="textarea">
              {d.notes}
            </textarea>
            <FieldError msg={d.errors.notes} />
          </div>
          <div class="flex gap-2">
            <button type="submit" class="btn h-11 flex-1">
              Save
            </button>
            <a href={cancel} class="btn h-11" data-variant="outline">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </Layout>
  );
}

function UnitField(props: { value: string; units: string[]; msg?: string }) {
  return (
    <div class="field">
      <label for="unit" class="label">
        Unit
      </label>
      <input
        id="unit"
        name="unit"
        type="text"
        value={props.value}
        maxlength={20}
        list="unit-options"
        autocomplete="off"
        placeholder="items"
        class="input h-11"
      />
      <datalist id="unit-options">
        {props.units.map((u) => (
          <option value={u} />
        ))}
      </datalist>
      <p class="text-sm text-muted-foreground">For example tins, rolls or kg.</p>
      <FieldError msg={props.msg} />
    </div>
  );
}

function SelectField(props: {
  name: string;
  label: string;
  selected: number;
  options: ListValue[];
  msg?: string;
}) {
  return (
    <div class="field">
      <label for={props.name} class="label">
        {props.label}
      </label>
      <select id={props.name} name={props.name} required class="select h-11 w-full">
        <option value="">Choose…</option>
        {props.options.map((v) => (
          <option value={idStr(v.id)} selected={isSelected(v.id, props.selected)}>
            {v.name}
          </option>
        ))}
      </select>
      <FieldError msg={props.msg} />
    </div>
  );
}

export interface ItemPageData {
  item: Item;
  history: Change[];
  /** Shown above the history, for example if undo failed. */
  error: string;
}

export const openDialog = (id: string) => `document.getElementById('${id}').showModal()`;

export function ItemPage({ page, data: d }: { page: Page; data: ItemPageData }) {
  return (
    <Layout page={page}>
      <div class="mx-auto grid max-w-xl gap-4">
        <a href="/" class="text-sm text-muted-foreground">
          ← All items
        </a>
        <div class="flex items-start justify-between gap-3">
          <h1 class="text-2xl font-semibold break-words">{d.item.name}</h1>
          <a href={`${itemUrl(d.item.id)}/edit`} class="btn" data-variant="outline" data-size="sm">
            Edit
          </a>
        </div>
        <ul class="grid gap-2">
          <Row item={d.item} msg="" />
        </ul>
        <dl class="card grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-sm">
          <dt class="text-muted-foreground">Category</dt>
          <dd>{orDash(d.item.categoryName)}</dd>
          <dt class="text-muted-foreground">Location</dt>
          <dd>{orDash(d.item.locationName)}</dd>
          <dt class="text-muted-foreground">Store</dt>
          <dd>{orDash(d.item.storeName)}</dd>
          {d.item.notes !== "" ? (
            <>
              <dt class="text-muted-foreground">Notes</dt>
              <dd class="whitespace-pre-line">{d.item.notes}</dd>
            </>
          ) : null}
        </dl>
        <section class="grid gap-2">
          <h2 class="text-lg font-semibold">History</h2>
          {d.error !== "" ? (
            <p class="text-sm text-destructive" role="alert">
              {d.error}
            </p>
          ) : null}
          <History itemId={d.item.id} unit={d.item.unit} changes={d.history} />
        </section>
        <div>
          <button
            type="button"
            class="btn"
            data-variant="destructive"
            data-size="sm"
            onclick={openDialog("delete-item")}
          >
            Delete item
          </button>
        </div>
        <ConfirmDialog
          id="delete-item"
          title={`Delete ${d.item.name}?`}
          body="This also deletes its history. It cannot be undone."
          action={itemAction(d.item.id, "delete")}
        />
      </div>
    </Layout>
  );
}

export function ConfirmDialog(props: { id: string; title: string; body: string; action: string }) {
  return (
    <dialog
      id={props.id}
      class="dialog"
      aria-labelledby={`${props.id}-title`}
      onclick="if (event.target === this) this.close()"
    >
      <div class="w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg">
        <header class="grid gap-1.5">
          <h2 id={`${props.id}-title`} class="text-lg font-semibold">
            {props.title}
          </h2>
          <p class="text-sm text-muted-foreground">{props.body}</p>
        </header>
        <footer class="mt-6 flex flex-row justify-end gap-2">
          <form method="dialog">
            <button type="submit" class="btn" data-variant="outline">
              Cancel
            </button>
          </form>
          <form method="post" action={props.action}>
            <button type="submit" class="btn" data-variant="destructive">
              Delete
            </button>
          </form>
        </footer>
      </div>
    </dialog>
  );
}

/** The latest changes. Only the newest has an undo button. */
function History(props: { itemId: number; unit: string; changes: Change[] }) {
  if (props.changes.length === 0) {
    return <p class="text-sm text-muted-foreground">No changes yet.</p>;
  }
  return (
    <ol class="grid gap-1.5">
      {props.changes.map((c, i) => (
        <li class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
          <span class="tabular-nums font-medium">{delta(c.delta)}</span>
          <span class="flex-1 text-muted-foreground">
            now <span class="tabular-nums">{String(c.count)}</span> {props.unit}
            {" · "}
            <time datetime={rfc3339(c.createdAt)} data-local>
              {fallbackTime(c.createdAt)}
            </time>
          </span>
          {i === 0 ? (
            <form method="post" action={itemAction(props.itemId, "undo")}>
              <button type="submit" class="btn" data-variant="outline" data-size="sm">
                Undo
              </button>
            </form>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
