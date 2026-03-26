import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

let _prisma: PrismaClient | null = null;

function createDefaultPrisma(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://dispatch:dispatch@localhost:5432/dispatch",
  });
  return new PrismaClient({ adapter });
}

export function setPrisma(client: PrismaClient) {
  _prisma = client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = _prisma ?? (_prisma = createDefaultPrisma());
    return Reflect.get(client, prop, receiver);
  },
});
