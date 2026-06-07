import { describe, expect, it } from "vitest";
import handler from "../src/index";

// The dashboard calls the worker cross-origin with an Authorization header,
// which triggers a CORS preflight. Without these headers the browser shows
// "Could not reach the Worker".
const env = {} as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;

function preflight(origin: string): Request {
  return new Request("https://worker.example/api/documents", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
}

describe("CORS", () => {
  it("allows the production dashboard origin on preflight", async () => {
    const res = await handler.fetch!(preflight("https://pm-assistant-web.pages.dev"), env, ctx);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://pm-assistant-web.pages.dev");
  });

  it("allows Pages branch/preview aliases", async () => {
    const res = await handler.fetch!(preflight("https://main.pm-assistant-web.pages.dev"), env, ctx);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://main.pm-assistant-web.pages.dev",
    );
  });

  it("does NOT echo an unknown origin", async () => {
    const res = await handler.fetch!(preflight("https://evil.example"), env, ctx);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
