import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleOwnerDigest } from "./cron/owner-digest";
import { handleRefreshWatches } from "./cron/refresh-watches";
import { handleRegulatoryScan } from "./cron/regulatory-scan";
import { handleDailySequences } from "./cron/sequences";
import { handleWeeklyDrift } from "./cron/weekly-drift";
import type { WorkerBindings } from "./lib/env";
import { createLogger } from "./lib/log";
import { demoRoute } from "./routes/demo";
import { documentsRoute } from "./routes/documents";
import { gmailWebhook } from "./routes/gmail-webhook";
import { health } from "./routes/health";
import { maintenanceRoute } from "./routes/maintenance";
import { oauthGmail } from "./routes/oauth-gmail";
import { onboardingRoute } from "./routes/onboarding";
import { regulatoryReview } from "./routes/regulatory-review";
import { sendRoute } from "./routes/send";
import { smsRoute } from "./routes/sms";

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

// CORS: the dashboard (Cloudflare Pages) calls the worker cross-origin with an
// Authorization header, which triggers a preflight. Allow the web-app origins
// (prod apex, branch/preview aliases, local dev). Server-to-server callers
// (Pub/Sub, Twilio) send no Origin and are unaffected.
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return undefined;
      try {
        const { hostname, protocol } = new URL(origin);
        const allowed =
          hostname === "pm-assistant-web.pages.dev" ||
          hostname.endsWith(".pm-assistant-web.pages.dev") ||
          (hostname === "localhost" && protocol === "http:");
        return allowed ? origin : undefined;
      } catch {
        return undefined;
      }
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }),
);

app.route("/", health);
app.route("/", gmailWebhook);
app.route("/", oauthGmail);
app.route("/", sendRoute);
app.route("/", maintenanceRoute);
app.route("/", documentsRoute);
app.route("/", smsRoute);
app.route("/", regulatoryReview);
app.route("/", demoRoute);
app.route("/", onboardingRoute);

const DAILY_REFRESH_CRON = "0 13 * * *";
const OWNER_DIGEST_CRON = "0 21 * * *";
// Cloudflare's scheduler rejects `0` for Sunday in the day-of-week field; use SUN.
const WEEKLY_DRIFT_CRON = "0 23 * * SUN";
const REGULATORY_SCAN_CRON = "0 15 * * *";
// 22:00 UTC = 08:00 AEST. Daily Phase 2 outbound-sequence sweep (lease-renewal,
// inspection, arrears, owner-update — all idempotent; see cron/sequences.ts).
const DAILY_SEQUENCES_CRON = "0 22 * * *";

// Dispatch by cron pattern. ScheduledController.cron carries the literal
// pattern that fired, so we route here rather than having each handler do
// its own filtering.
async function scheduled(
  controller: ScheduledController,
  env: WorkerBindings,
  _ctx: ExecutionContext,
): Promise<void> {
  if (controller.cron === DAILY_REFRESH_CRON) {
    await handleRefreshWatches(controller, env);
    return;
  }
  if (controller.cron === OWNER_DIGEST_CRON) {
    await handleOwnerDigest(controller, env);
    return;
  }
  if (controller.cron === WEEKLY_DRIFT_CRON) {
    await handleWeeklyDrift(controller, env);
    return;
  }
  if (controller.cron === REGULATORY_SCAN_CRON) {
    await handleRegulatoryScan(controller, env);
    return;
  }
  if (controller.cron === DAILY_SEQUENCES_CRON) {
    await handleDailySequences(controller, env);
    return;
  }
  createLogger({ base: { request_id: crypto.randomUUID() } }).warn("unknown cron trigger", {
    cron: controller.cron,
  });
}

// The Workers runtime expects `default` to be an object with `fetch` and/or
// `scheduled`. We expose both so the same worker handles HTTP traffic and
// the cron triggers.
const handler: ExportedHandler<WorkerBindings> = {
  fetch: app.fetch,
  scheduled,
};

export default handler;
