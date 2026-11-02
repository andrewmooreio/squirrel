import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Serves /static/… from a directory on disk. */
export function diskAssets(dir: string) {
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const rel = normalize(decodeURIComponent(url.pathname.replace(/^\/static\//, "")));
    if (rel.startsWith("..") || rel.split(sep).includes("..")) return null;
    const type = TYPES[extname(rel)];
    if (!type) return null;
    try {
      const body = await readFile(join(dir, rel));
      return new Response(body, {
        headers: {
          "Content-Type": type,
          // A URL with ?v= comes from our own pages. Its content hash changes with the file.
          "Cache-Control": url.searchParams.get("v")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      });
    } catch {
      return null;
    }
  };
}
