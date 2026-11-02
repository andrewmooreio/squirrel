// The distroless image has no shell or curl, so the Docker health check
// runs this script with Node.
import { loadConfig } from "./config";

try {
  const { host, port } = loadConfig();
  const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${target.includes(":") ? `[${target}]` : target}:${port}/healthz`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`healthz returned ${res.status}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
