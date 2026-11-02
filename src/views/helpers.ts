import type { ListKind } from "../db/types";

export interface Page {
  title: string;
  /** "lists" or "shopping" when that header link is the current page. */
  nav: string;
  /** The app version shown in the footer. */
  version: string;
}

export const itemUrl = (id: number) => `/items/${id}`;
export const itemAction = (id: number, action: string) => `/items/${id}/${action}`;
export const rowId = (id: number) => `item-${id}`;
export const rowTarget = (id: number) => `#${rowId(id)}`;
export const listUrl = (kind: ListKind) => `/lists/${kind}`;
export const listValueAction = (kind: ListKind, id: number, action = "") =>
  action ? `/lists/${kind}/${id}/${action}` : `/lists/${kind}/${id}`;
export const dialogId = (id: number) => `delete-${id}`;

export const orDash = (s: string) => (s === "" ? "—" : s);
export const idStr = (id: number) => (id === 0 ? "" : String(id));
export const isSelected = (id: number, want: number) => id !== 0 && id === want;
export const boolStr = (b: boolean) => (b ? "true" : "false");
export const onValue = (on: boolean) => (on ? "1" : "0");

export const kindLabel = (k: ListKind) =>
  k === "categories" ? "category" : k === "locations" ? "location" : "store";

export const kindPlural = (k: ListKind) =>
  k === "categories" ? "Categories" : k === "locations" ? "Locations" : "Stores";

export const plural = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : `${n} ${many}`;

/** An RFC 3339 time in UTC, to the second. */
export const rfc3339 = (iso: string) => `${new Date(iso).toISOString().slice(0, 19)}Z`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The time as text, for a browser with no JavaScript: 2 Jan 2006 15:04 UTC. */
export function fallbackTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export const delta = (d: number) => (d > 0 ? `+${d}` : String(d));
