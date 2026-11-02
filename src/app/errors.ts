import { BelowZeroError, DuplicateError } from "../db/errors";

export { BelowZeroError, DuplicateError };

/** The item, list value or change does not exist. */
export class NotFoundError extends Error {
  constructor() {
    super("not found");
    this.name = "NotFoundError";
  }
}

/** Invalid fields, with a message for each. */
export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super(
      `validation failed: ${Object.entries(fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ")}`,
    );
    this.name = "ValidationError";
  }
}

export const invalid = (field: string, msg: string) => new ValidationError({ [field]: msg });
