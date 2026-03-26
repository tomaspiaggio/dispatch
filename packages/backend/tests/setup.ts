import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { execSync } from "child_process";
import { setPrisma } from "../src/lib/prisma";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

export async function setupTestDb() {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("dispatch_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionString = container.getConnectionUri();

  execSync(`npx prisma db push --url "${connectionString}"`, {
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
    },
    cwd: new URL("../", import.meta.url).pathname,
    stdio: "pipe",
  });

  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });

  // Inject test prisma into the global singleton so tRPC router uses it
  setPrisma(prisma);

  return { prisma, connectionString };
}

export async function teardownTestDb() {
  await prisma?.$disconnect();
  await container?.stop();
}

export function getTestPrisma() {
  return prisma;
}
