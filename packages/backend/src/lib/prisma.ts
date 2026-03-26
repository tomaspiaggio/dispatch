import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://dispatch:dispatch@localhost:5432/dispatch",
});

export const prisma = new PrismaClient({ adapter });
