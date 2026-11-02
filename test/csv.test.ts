import { describe, expect, it } from "vitest";
import { csvLine, parseCsv } from "../src/app/csv";

describe("csv", () => {
  it("reads quoted fields, ragged rows and start lines", () => {
    const recs = parseCsv('a,b\r\n\r\nx,"two\nlines",z\n\nlast');
    expect(recs).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 3, fields: ["x", "two\nlines", "z"] },
      { line: 6, fields: ["last"] },
    ]);
  });

  it("refuses a bare quote and an open quote", () => {
    expect(() => parseCsv('a,b"c\n')).toThrow();
    expect(() => parseCsv('a,"b\n')).toThrow();
    expect(() => parseCsv('a,"b"c\n')).toThrow();
  });

  it("writes a field with a comma, quote or new line in quotes", () => {
    expect(csvLine(["a", "", 'b"c', "d,e", "f\ng"])).toBe('a,,"b""c","d,e","f\ng"\n');
  });
});
