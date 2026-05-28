import { Hono } from "hono";
import type { WorkerBindings } from "./lib/env";
import { gmailWebhook } from "./routes/gmail-webhook";
import { health } from "./routes/health";

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

export default app;
