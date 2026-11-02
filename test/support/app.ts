import { expect } from "vitest";
import { newDriver } from "#driver";
import { createApp } from "../../src/app/app";
import { createStore, type Item, type Store } from "../../src/app/store";
import { ensureMigrated } from "../../src/db/migrate";
import type { Driver } from "../../src/db/types";

const BASE = "http://example.com";

export interface Resp {
  status: number;
  headers: Headers;
  body: string;
}

export const htmx = { "HX-Request": "true" };

export class TestApp {
  constructor(
    readonly driver: Driver,
    readonly store: Store,
    private readonly app: ReturnType<typeof createApp>,
  ) {}

  /** Creates one value in each list and returns their ids. */
  async seed() {
    return {
      cat: await this.store.createListValue("categories", "Food"),
      loc: await this.store.createListValue("locations", "Garage"),
      shop: await this.store.createListValue("stores", "Costco"),
    };
  }

  item(name: string, count: number, cat: number, loc: number, shop: number): Promise<Item> {
    return this.store.createItem({
      name,
      count,
      categoryId: cat,
      locationId: loc,
      storeId: shop,
    });
  }

  private async send(path: string, init: RequestInit): Promise<Resp> {
    const res = await this.app.request(`${BASE}${path}`, init);
    return { status: res.status, headers: res.headers, body: await res.text() };
  }

  get(path: string, headers: Record<string, string> = {}) {
    return this.send(path, { method: "GET", headers });
  }

  post(path: string, form?: Record<string, string>, headers: Record<string, string> = {}) {
    if (!form) return this.send(path, { method: "POST", headers });
    return this.send(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(form).toString(),
    });
  }

  request(path: string, init: RequestInit) {
    return this.send(path, init);
  }

  upload(path: string, field: string, filename: string, content: string) {
    const body = new FormData();
    body.set(field, new File([content], filename, { type: "text/csv" }));
    return this.send(path, { method: "POST", body });
  }
}

export async function newApp(version = "dev"): Promise<TestApp> {
  const driver = await newDriver();
  await ensureMigrated(driver);
  return new TestApp(driver, createStore(driver), createApp({ driver, version }));
}

export const wantStatus = (r: Resp, status: number) =>
  expect(r.status, `body:\n${r.body}`).toBe(status);

export const wantRedirect = (r: Resp, to: string) => {
  wantStatus(r, 303);
  expect(r.headers.get("Location")).toBe(to);
};

export const contains = (r: Resp, ...subs: string[]) => {
  for (const s of subs) expect(r.body, `body does not contain ${s}`).toContain(s);
};

export const lacks = (r: Resp, ...subs: string[]) => {
  for (const s of subs) expect(r.body).not.toContain(s);
};
