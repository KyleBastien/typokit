// @typokit/nx — Init generator schema
export interface InitGeneratorSchema {
  project: string;
  server?: "native" | "fastify" | "hono" | "express";
  db?: "drizzle" | "kysely" | "prisma" | "raw" | "none";
}
