/** A row with the same name exists already. */
export class DuplicateError extends Error {
  constructor() {
    super("name already in use");
    this.name = "DuplicateError";
  }
}

/** The change would make a count negative. */
export class BelowZeroError extends Error {
  constructor() {
    super("count would go below zero");
    this.name = "BelowZeroError";
  }
}
