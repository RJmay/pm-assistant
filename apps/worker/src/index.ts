import { Hono } from "hono";
import { handleScheduled } from "./cron/refresh-watches";
import type { WorkerBindings } from "./lib/env";
import { gmailWebhook } from "./routes/gmail-webhook";
import { health } from "./routes/health";
import { oauthGmail } from "./routes/oauth-gmail";

type Vars = { requestId: string };

const app = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

// Attach a request_id to every incoming request so downstream logs are
// correlatable. Echoed back via X-Request-Id for client-side debugging.
app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});

app.route("/", health);
app.route("/", gmailWebhook);
app.route("/", oauthGmail);

// The Workers runtime expects `default` to be an object with `fetch` and/or
// `scheduled`. We expose both so the same worker handles HTTP traffic and
// the daily cron that refreshes Gmail watch subscriptions.
const handler: ExportedHandler<WorkerBindings> = {
  fetch: app.fetch,
  scheduled: handleScheduled,
};

export default handler;
