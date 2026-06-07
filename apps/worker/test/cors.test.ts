import { describe, expect, it } from "vitest";
import handler from "../src/index";

// The dashboard calls the worker cross-origin with an Authorization header,
// which triggers a CORS preflight. Without these headers the browser shows
// "Could not reach the Worker".
const env = {} as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
const fetchFn = handler.fetch;
if (!fetchFn) throw new Error("worker handler has no fetch");

// Cast to the worker's expected request type (CF IncomingRequest) — the test
// only exercises the CORS preflight, which never touches the Cf properties.
type FetchReq = Parameters<NonNullable<typeof handler.fetch>>[0];
function preflight(origin: string): FetchReq {
  return new Request("https://worker.example/api/documents", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  }) as unknown as FetchReq;
}

describe("CORS", () => {
  it("allows the production dashboard origin on preflight", async () => {
    const res = await fetchFn(preflight("https://pm-assistant-web.pages.dev"), env, ctx);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://pm-assistant-web.pages.dev",
    );
  });

  it("allows Pages branch/preview aliases", async () => {
    const res = await fetchFn(
      preflight("https://main.pm-assistant-web.pages.dev"),
      env,
      ctx,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://main.pm-assistant-web.pages.dev",
    );
  });

  it("does NOT echo an unknown origin", async () => {
    const res = await fetchFn(preflight("https://evil.example"), env, ctx);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
