import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const workloadsTable = pgTable("adaptiveos_workloads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  source: text("source").notNull(),
  profile: text("profile").notNull(),
  seed: integer("seed"),
  snapshotId: integer("snapshot_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const processesTable = pgTable("adaptiveos_processes", {
  id: serial("id").primaryKey(),
  workloadId: integer("workload_id")
    .notNull()
    .references(() => workloadsTable.id, { onDelete: "cascade" }),
  pid: text("pid").notNull(),
  arrivalTime: doublePrecision("arrival_time").notNull(),
  burstTime: doublePrecision("burst_time").notNull(),
  priority: integer("priority").notNull(),
  memoryMb: doublePrecision("memory_mb").notNull(),
});
