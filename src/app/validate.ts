import { invalid, ValidationError } from "./errors";

export const DEFAULT_UNIT = "items";
const MAX_NAME = 100;
const MAX_NOTES = 2000;
const MAX_UNIT = 20;

const length = (s: string) => [...s].length;

/** Trims a name. It throws a ValidationError on the field "name". */
export function cleanName(name: string): string {
  const n = name.trim();
  if (n === "") throw invalid("name", "Enter a name.");
  if (length(n) > MAX_NAME) throw invalid("name", "Use 100 characters or fewer.");
  return n;
}

/** Returns the clean unit and a message. A blank unit means DEFAULT_UNIT. */
export function cleanUnit(unit: string): { unit: string; message: string } {
  const u = unit.trim();
  if (u === "") return { unit: DEFAULT_UNIT, message: "" };
  if (length(u) > MAX_UNIT) return { unit: u, message: "Use 20 characters or fewer." };
  return { unit: u, message: "" };
}

export function cleanNotes(notes: string): { notes: string; message: string } {
  const n = notes.trim();
  return { notes: n, message: length(n) > MAX_NOTES ? "Use 2000 characters or fewer." : "" };
}

export const COUNT_MESSAGE = "Enter a whole number of 0 or more.";

/** Parses a whole number like Go's Atoi: optional sign, digits only. */
export function atoi(s: string): number | null {
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parses a count. It returns null if the text is not a whole number of 0 or more. */
export function parseCount(s: string): number | null {
  const n = atoi(s.trim());
  return n !== null && n >= 0 ? n : null;
}

/** Parses an id from a form or query. Anything that does not parse is 0. */
export function parseId(s: string | undefined | null): number {
  const n = atoi((s ?? "").trim());
  return n !== null && n > 0 ? n : 0;
}

/** Parses an id from a path. It returns null unless the id is above 0. */
export function pathId(s: string | undefined): number | null {
  const n = atoi(s ?? "");
  return n !== null && n > 0 ? n : null;
}

export { ValidationError };
