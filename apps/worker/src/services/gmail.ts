import { GmailApiError } from "@pm/shared";
import { z } from "zod";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

// ----------------------------------------------------------------------------
// Response schemas
// ----------------------------------------------------------------------------

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string(),
  id_token: z.string().optional(),
});
export type GoogleTokenResponse = z.infer<typeof tokenResponseSchema>;

const historyMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

const historyEntrySchema = z.object({
  id: z.string(),
  messages: z.array(historyMessageSchema).optional(),
  messagesAdded: z.array(z.object({ message: historyMessageSchema })).optional(),
});

const historyListSchema = z.object({
  history: z.array(historyEntrySchema).optional(),
  historyId: z.string(),
  nextPageToken: z.string().optional(),
});
export type HistoryListResponse = z.infer<typeof historyListSchema>;

// Gmail message payload — parts can recurse, so we declare the schema using
// a typed lazy reference.
type GmailHeader = { name: string; value: string };
type GmailBody = { data?: string; size: number };
interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
}

const gmailHeaderSchema = z.object({ name: z.string(), value: z.string() });
const gmailBodySchema = z.object({ data: z.string().optional(), size: z.number() });

const gmailPartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(gmailHeaderSchema).optional(),
    body: gmailBodySchema.optional(),
    parts: z.array(gmailPartSchema).optional(),
  }),
);

const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  internalDate: z.string(),
  payload: gmailPartSchema,
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;

const watchResponseSchema = z.object({
  historyId: z.string(),
  expiration: z.string(),
});
export type WatchResponse = z.infer<typeof watchResponseSchema>;

const profileSchema = z.object({
  emailAddress: z.string(),
  messagesTotal: z.number().optional(),
  threadsTotal: z.number().optional(),
  historyId: z.string(),
});
export type GmailProfile = z.infer<typeof profileSchema>;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function parseJsonResponse<T>(
  res: Response,
  endpoint: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => "(unreadable)");
    }
    throw new GmailApiError(`Gmail API ${res.status} on ${endpoint}`, {
      statusCode: res.status,
      endpoint,
      responseBody: body,
    });
  }
  const raw = await res.json().catch((cause) => {
    throw new GmailApiError(`Gmail API returned non-JSON body on ${endpoint}`, {
      statusCode: res.status,
      endpoint,
      cause,
    });
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new GmailApiError(`Gmail API response failed schema validation on ${endpoint}`, {
      statusCode: res.status,
      endpoint,
      responseBody: raw,
    });
  }
  return parsed.data;
}

// ----------------------------------------------------------------------------
// OAuth: exchange auth code + refresh access token
// ----------------------------------------------------------------------------

export interface ExchangeCodeOpts {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export async function exchangeCode(opts: ExchangeCodeOpts): Promise<GoogleTokenResponse> {
  const f = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await f(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseJsonResponse(res, "POST oauth2/token (exchange)", tokenResponseSchema);
}

export interface RefreshAccessTokenOpts {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(
  opts: RefreshAccessTokenOpts,
): Promise<GoogleTokenResponse> {
  const f = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await f(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseJsonResponse(res, "POST oauth2/token (refresh)", tokenResponseSchema);
}

// ----------------------------------------------------------------------------
// Gmail API: profile, history.list (paginated), messages.get, users.watch
// ----------------------------------------------------------------------------

export interface AuthedOpts {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export async function usersGetProfile(mailbox: string, opts: AuthedOpts): Promise<GmailProfile> {
  const f = opts.fetchImpl ?? fetch;
  const endpoint = `GET users/${mailbox}/profile`;
  const res = await f(`${GMAIL_BASE}/users/${encodeURIComponent(mailbox)}/profile`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  return parseJsonResponse(res, endpoint, profileSchema);
}

export interface UsersHistoryListOpts extends AuthedOpts {
  mailbox: string;
  startHistoryId: string;
  pageToken?: string;
  /** Filter by history type. We only care about message addition. */
  historyTypes?: Array<"messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved">;
}

export async function usersHistoryList(opts: UsersHistoryListOpts): Promise<HistoryListResponse> {
  const f = opts.fetchImpl ?? fetch;
  const url = new URL(`${GMAIL_BASE}/users/${encodeURIComponent(opts.mailbox)}/history`);
  url.searchParams.set("startHistoryId", opts.startHistoryId);
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  for (const t of opts.historyTypes ?? ["messageAdded"]) {
    url.searchParams.append("historyTypes", t);
  }
  const endpoint = `GET users/${opts.mailbox}/history`;
  const res = await f(url.toString(), {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  return parseJsonResponse(res, endpoint, historyListSchema);
}

export interface UsersMessagesGetOpts extends AuthedOpts {
  mailbox: string;
  messageId: string;
  /** "full" returns parsed payload with headers + body. */
  format?: "full" | "metadata" | "minimal" | "raw";
}

export async function usersMessagesGet(opts: UsersMessagesGetOpts): Promise<GmailMessage> {
  const f = opts.fetchImpl ?? fetch;
  const url = new URL(
    `${GMAIL_BASE}/users/${encodeURIComponent(opts.mailbox)}/messages/${encodeURIComponent(opts.messageId)}`,
  );
  url.searchParams.set("format", opts.format ?? "full");
  const endpoint = `GET users/${opts.mailbox}/messages/${opts.messageId}`;
  const res = await f(url.toString(), {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  return parseJsonResponse(res, endpoint, gmailMessageSchema);
}

export interface UsersWatchOpts extends AuthedOpts {
  mailbox: string;
  topicName: string;
  /** Restrict to specific labels; default ["INBOX"]. */
  labelIds?: string[];
  /** Default "include" — only deliver notifications for the listed labels. */
  labelFilterAction?: "include" | "exclude";
}

export async function usersWatch(opts: UsersWatchOpts): Promise<WatchResponse> {
  const f = opts.fetchImpl ?? fetch;
  const endpoint = `POST users/${opts.mailbox}/watch`;
  const res = await f(`${GMAIL_BASE}/users/${encodeURIComponent(opts.mailbox)}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName: opts.topicName,
      labelIds: opts.labelIds ?? ["INBOX"],
      labelFilterAction: opts.labelFilterAction ?? "include",
    }),
  });
  return parseJsonResponse(res, endpoint, watchResponseSchema);
}
