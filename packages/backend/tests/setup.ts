import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { setPrisma } from "../src/lib/prisma";

let prisma: PrismaClient;

const DEFAULT_CONNECTION_STRING =
  "postgresql://test:test@localhost:5432/dispatch_test";

export async function setupTestDb() {
  const connectionString =
    process.env.__TEST_CONNECTION_STRING || DEFAULT_CONNECTION_STRING;

  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });

  // Inject test prisma into the global singleton so step functions & tRPC router use it
  setPrisma(prisma);

  return { prisma, connectionString };
}

export async function teardownTestDb() {
  await prisma?.$disconnect();
}

export function getTestPrisma() {
  return prisma;
}
