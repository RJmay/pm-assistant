import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteGmailRefreshToken,
  getGmailRefreshToken,
  storeGmailRefreshToken,
} from "../src/services/vault";

const AGENCY_ID = "00000000-0000-0000-0000-000000000001";

interface RpcCall {
  fn: string;
  args: unknown;
}

function makeClient(opts: { data?: unknown; error?: { message: string } }) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: opts.data ?? null, error: opts.error ?? null };
    }),
  };
  return { client: client as unknown as Client, calls };
}

describe("storeGmailRefreshToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls store_gmail_refresh_token with the agency id and token", async () => {
    const { client, calls } = makeClient({});
    await storeGmailRefreshToken(client, AGENCY_ID, "refresh-xyz");
    expect(calls).toEqual([
      { fn: "store_gmail_refresh_token", args: { p_agency_id: AGENCY_ID, p_token: "refresh-xyz" } },
    ]);
  });

  it("throws when the RPC returns an error", async () => {
    const { client } = makeClient({ error: { message: "vault unavailable" } });
    await expect(storeGmailRefreshToken(client, AGENCY_ID, "x")).rejects.toThrow(
      /vault unavailable/,
    );
  });
});

describe("getGmailRefreshToken", () => {
  it("returns the decrypted token from the RPC", async () => {
    const { client, calls } = makeClient({ data: "refresh-token-stored" });
    const token = await getGmailRefreshToken(client, AGENCY_ID);
    expect(token).toBe("refresh-token-stored");
    expect(calls[0]).toEqual({
      fn: "get_gmail_refresh_token",
      args: { p_agency_id: AGENCY_ID },
    });
  });

  it("returns null when no mapping exists", async () => {
    const { client } = makeClient({ data: null });
    expect(await getGmailRefreshToken(client, AGENCY_ID)).toBeNull();
  });

  it("throws when the RPC errors", async () => {
    const { client } = makeClient({ error: { message: "denied" } });
    await expect(getGmailRefreshToken(client, AGENCY_ID)).rejects.toThrow(/denied/);
  });
});

describe("deleteGmailRefreshToken", () => {
  it("calls delete_gmail_refresh_token", async () => {
    const { client, calls } = makeClient({});
    await deleteGmailRefreshToken(client, AGENCY_ID);
    expect(calls[0]).toEqual({
      fn: "delete_gmail_refresh_token",
      args: { p_agency_id: AGENCY_ID },
    });
  });

  it("throws when the RPC errors", async () => {
    const { client } = makeClient({ error: { message: "missing row" } });
    await expect(deleteGmailRefreshToken(client, AGENCY_ID)).rejects.toThrow(/missing row/);
  });
});
