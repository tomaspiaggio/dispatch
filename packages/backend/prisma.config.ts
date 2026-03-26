import path from "node:path";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://dispatch:dispatch@localhost:5432/dispatch";

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrate: {
    url: databaseUrl,
  },
  // Used by db push
  datasource: {
    url: databaseUrl,
  },
});
