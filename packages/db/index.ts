import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function readPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function databaseUrlWithPoolSettings() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;

  const connectionLimit = readPositiveInt(
    process.env.PRISMA_CONNECTION_LIMIT,
    process.env.NODE_ENV === "production" ? 10 : 5,
  );
  const poolTimeout = readPositiveInt(process.env.PRISMA_POOL_TIMEOUT, 20);

  try {
    const url = new URL(databaseUrl);

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", String(connectionLimit));
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", String(poolTimeout));
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

// Prisma Client will automatically use DATABASE_URL from process.env
const prisma =
  globalForPrisma?.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrlWithPoolSettings(),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });


// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export { PrismaClient as PrismaClientSingleton };

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Export db for use in the application
export const db = prisma;
export { prisma };
