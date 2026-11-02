export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
}

/** Reads the settings from the environment. An empty value counts as unset. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const get = (key: string, fallback: string) => {
    const v = env[key];
    return v === undefined || v === "" ? fallback : v;
  };
  const portText = get("PORT", "8080");
  const port = /^\d+$/.test(portText) ? Number(portText) : Number.NaN;
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(`PORT must be a number from 1 to 65535, got "${portText}"`);
  }
  return {
    host: get("HOST", "0.0.0.0"),
    port,
    databaseUrl: get("DATABASE_URL", "sqlite:///data/squirrel.db"),
  };
}
