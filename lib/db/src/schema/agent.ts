import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type AgentProcess = {
  pid: number;
  name: string;
  createdAt?: string | null;
  status?: string | null;
  cpuPercent?: number | null;
  memoryMb?: number | null;
};

export const agentSnapshotsTable = pgTable("adaptiveos_agent_snapshots", {
  id: serial("id").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  observationSeconds: doublePrecision("observation_seconds").notNull(),
  processes: jsonb("processes").$type<AgentProcess[]>().notNull(),
  processCount: integer("process_count").notNull(),
});
