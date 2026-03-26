import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { execSync } from "child_process";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

export async function setupTestDb() {
  // Start PostgreSQL container
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("dispatch_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionString = container.getConnectionUri();

  // Run Prisma db push with the test container's URL
  execSync(`npx prisma db push --url "${connectionString}"`, {
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
    },
    cwd: new URL("../", import.meta.url).pathname,
    stdio: "pipe",
  });

  // Create Prisma client
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });

  return { prisma, connectionString };
}

export async function teardownTestDb() {
  await prisma?.$disconnect();
  await container?.stop();
}

export function getTestPrisma() {
  return prisma;
}
