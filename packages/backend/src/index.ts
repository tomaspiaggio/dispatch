import { Hono } from "hono";
import { cors } from "hono/cors";
import apiRoutes from "./routes/api";
import webhookRoutes from "./routes/webhooks";
import sseRoutes, { broadcast as sseBroadcast } from "./routes/ws";
import { setBroadcaster } from "./lib/ws";
import { registerThreadPoster } from "./chat/post";

const app = new Hono();

// Wire SSE broadcaster so steps can push events
setBroadcaster(sseBroadcast);

// Register thread poster — lazy imports bot to avoid bundling chat-sdk in workflow
registerThreadPoster(async (threadJson, message) => {
  const { bot } = await import("./chat/bot");
  const thread = JSON.parse(threadJson, bot.reviver());
  await thread.post(message);
});

// Middleware
app.use("/*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api", apiRoutes);
app.route("/webhooks", webhookRoutes);
app.route("/sse", sseRoutes);

// Lazy init chat to avoid pulling Node.js-only chat-sdk modules into workflow bundle
import("./chat/handlers")
  .then(({ initChat }) => initChat())
  .catch((err) => {
    console.error("Failed to initialize chat connections:", err);
  });

export default app;
