import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./trpc/router";
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

// tRPC handler
app.all("/trpc/*", (c) => {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({}),
  });
});

// POST /api/prompt — external trigger for workflows (curl, cron, integrations)
app.post("/api/prompt", async (c) => {
  const body = await c.req.json<{
    prompt: string;
    platform?: string;
    channelId?: string;
    conversationId?: string;
  }>();

  if (!body.prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const { executePromptAndDeliver } = await import("./chat/deliver");
  const result = await executePromptAndDeliver(
    body.prompt,
    body.platform ?? "web",
    body.channelId ?? "api",
    body.conversationId,
  );

  return c.json(result);
});

// Other routes
app.route("/webhooks", webhookRoutes);
app.route("/sse", sseRoutes);

// Lazy init chat + scheduler to avoid pulling Node.js-only modules into workflow bundle
import("./chat/handlers")
  .then(({ initChat }) => initChat())
  .catch((err) => {
    console.error("Failed to initialize chat connections:", err);
  });

import("./scheduler")
  .then(({ startScheduler }) => startScheduler())
  .catch((err) => {
    console.error("Failed to start scheduler:", err);
  });

export default app;
