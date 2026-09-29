import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

// Reuse the client across serverless invocations in ALL envs.
// Without this, Vercel production opens a new DB pool per invocation
// and Supabase direct connections exhaust → 500s under any traffic.
globalForPrisma.prisma = prisma;