import type { Context, Hono } from "hono";
import { ImportDone, Transfer } from "../../views/transfer";
import { CsvError, csvLine, parseCsv } from "../csv";
import { type Deps, message, page, render } from "../http";
import type { ImportRow } from "../store";

const MAX_IMPORT_BYTES = 1 << 20;
const CSV_HEADER = ["name", "count", "unit", "category", "location", "store", "notes"];
const MSG_UNREADABLE = "Squirrel cannot read this file. Check that it is a CSV file.";
const MSG_COLUMNS = "The file needs these columns: name, category, location, store.";
const MSG_TOO_BIG = "The file is too big. Use a file of 1 MB or less.";

/** The most bytes to read and drop from a body that is too big. */
const MAX_DRAIN_BYTES = 32 << 20;

/**
 * Reads the rest of a body that is too big and drops it. A cancel here makes
 * the body's own producer throw on Node 24. A hard cap stops a body with no end.
 */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, seen: number) {
  let total = seen;
  while (total < MAX_DRAIN_BYTES) {
    const { done, value } = await reader.read();
    if (done) return;
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
}

/** Reads the body up to max bytes. It returns null if the body is bigger. */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await drain(reader, total);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

type ReadResult = { rows: ImportRow[] } | { status: number; message: string };

/** Parses the CSV. On a problem it returns an HTTP status and a message for the user. */
function readImportRows(text: string): ReadResult {
  let records: ReturnType<typeof parseCsv>;
  try {
    records = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) return { status: 422, message: MSG_UNREADABLE };
    throw err;
  }
  const head = records.shift();
  if (!head) return { status: 422, message: MSG_COLUMNS };

  const col = new Map<string, number>();
  head.fields.forEach((h, i) => {
    const name = (i === 0 ? h.replace(/^﻿/, "") : h).trim().toLowerCase();
    if (!col.has(name)) col.set(name, i);
  });
  for (const need of ["name", "category", "location", "store"]) {
    if (!col.has(need)) return { status: 422, message: MSG_COLUMNS };
  }

  const rows: ImportRow[] = [];
  for (const rec of records) {
    const field = (name: string) => {
      const i = col.get(name);
      return i !== undefined ? (rec.fields[i] ?? "") : "";
    };
    const row: ImportRow = {
      line: rec.line,
      name: field("name"),
      count: field("count"),
      unit: field("unit"),
      category: field("category"),
      location: field("location"),
      store: field("store"),
      notes: field("notes"),
    };
    const blank = [
      row.name,
      row.count,
      row.unit,
      row.category,
      row.location,
      row.store,
      row.notes,
    ].every((v) => v.trim() === "");
    if (!blank) rows.push(row);
  }
  return { rows };
}

export function transferRoutes(app: Hono, d: Deps) {
  const failImport = (c: Context, status: number, body: string) =>
    message(c, d, status, "Import failed", body, {
      href: "/transfer",
      label: "Back to import",
      nav: "lists",
    });

  app.get("/transfer", (c) =>
    render(c, 200, <Transfer page={page(d, "Import and export", "lists")} />),
  );

  app.get("/export.csv", async (c) => {
    const items = await d.store.listItems();
    const lines = [csvLine(CSV_HEADER)];
    for (const it of items) {
      lines.push(
        csvLine([
          it.name,
          String(it.count),
          it.unit,
          it.categoryName,
          it.locationName,
          it.storeName,
          it.notes,
        ]),
      );
    }
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="squirrel-items-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    c.header("Cache-Control", "no-store");
    return c.body(lines.join(""));
  });

  app.post("/import", async (c) => {
    const body = await readLimited(c.req.raw, MAX_IMPORT_BYTES);
    if (body === null) return failImport(c, 413, MSG_TOO_BIG);

    let file: unknown;
    try {
      const form = await new Request(c.req.url, {
        method: "POST",
        headers: { "content-type": c.req.header("content-type") ?? "" },
        body: body as BodyInit,
      }).formData();
      file = form.get("file");
    } catch {
      file = null;
    }
    if (!(file instanceof File)) return failImport(c, 400, "Choose a CSV file.");

    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await file.arrayBuffer());
    const read = readImportRows(text);
    if ("message" in read) return failImport(c, read.status, read.message);

    const result = await d.store.importItems(read.rows);
    return render(c, 200, <ImportDone page={page(d, "Import done", "lists")} result={result} />);
  });
}
