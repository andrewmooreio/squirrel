/** A CSV record and the line where it starts. */
export interface CsvRecord {
  line: number;
  fields: string[];
}

export class CsvError extends Error {}

/**
 * Reads CSV text with the rules of Go's encoding/csv: records can have any
 * number of fields, empty lines are skipped, a quote in an unquoted field is
 * an error, and a quoted field can hold commas, quotes and new lines.
 */
export function parseCsv(text: string): CsvRecord[] {
  const out: CsvRecord[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;

  while (i < n) {
    // Skip empty lines.
    if (text[i] === "\n") {
      i++;
      line++;
      continue;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") {
      i += 2;
      line++;
      continue;
    }

    const startLine = line;
    const fields: string[] = [];
    for (;;) {
      let field = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) throw new CsvError("extraneous or missing quote");
          const ch = text[i];
          if (ch === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (ch === "\r" && text[i + 1] === "\n") {
            field += "\n";
            i += 2;
            line++;
            continue;
          }
          if (ch === "\n") line++;
          field += ch;
          i++;
        }
        const next = text[i];
        if (i < n && next !== "," && next !== "\n" && !(next === "\r" && text[i + 1] === "\n")) {
          throw new CsvError("extraneous or missing quote");
        }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n") {
          if (text[i] === "\r" && text[i + 1] === "\n") break;
          if (text[i] === '"') throw new CsvError("bare quote in non-quoted field");
          field += text[i];
          i++;
        }
      }
      fields.push(field);

      if (i >= n) break;
      if (text[i] === ",") {
        i++;
        continue;
      }
      // End of the record.
      i += text[i] === "\r" ? 2 : 1;
      line++;
      break;
    }
    out.push({ line: startLine, fields });
  }
  return out;
}

const needsQuotes = (f: string) => f !== "" && (f === "\\." || /[,"\r\n]/.test(f) || /^\s/.test(f));

/** Writes one record like Go's encoding/csv, with a "\n" line end. */
export function csvLine(fields: string[]): string {
  return `${fields.map((f) => (needsQuotes(f) ? `"${f.replaceAll('"', '""')}"` : f)).join(",")}\n`;
}
