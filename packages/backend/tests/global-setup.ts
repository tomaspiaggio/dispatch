import { execSync } from "child_process";

const LOCAL_CONNECTION_STRING =
  "postgresql://test:test@localhost:5432/dispatch_test";

export async function setup() {
  let connectionString: string;

  try {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("dispatch_test")
      .withUsername("test")
      .withPassword("test")
      .start();

    connectionString = container.getConnectionUri();
    (globalThis as any).__testcontainer = container;
  } catch {
    connectionString = LOCAL_CONNECTION_STRING;

    // Reset the test database so db push doesn't conflict on existing enums
    try {
      execSync(
        `psql "${connectionString}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`,
        { stdio: "pipe" }
      );
    } catch {
      // Ignore if psql not available — db push will handle a fresh DB
    }
  }

  process.env.__TEST_CONNECTION_STRING = connectionString;

  execSync(`npx prisma db push --url "${connectionString}"`, {
    env: { ...process.env, DATABASE_URL: connectionString },
    cwd: new URL("../", import.meta.url).pathname,
    stdio: "pipe",
  });
}

export async function teardown() {
  const container = (globalThis as any).__testcontainer;
  if (container) {
    await container.stop();
  }
}
