import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../backend/src/trpc/router";

export type { AppRouter };

export const trpc = createTRPCReact<AppRouter>();

const BASE = process.env.DISPATCH_API_URL ?? "http://localhost:3000";

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${BASE}/trpc`,
    }),
  ],
});
