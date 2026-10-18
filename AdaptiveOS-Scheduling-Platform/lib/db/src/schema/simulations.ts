import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { workloadsTable } from "./workloads";

export type SimulationMetrics = {
  averageWaitingTime: number;
  averageTurnaroundTime: number;
  averageResponseTime: number;
  cpuUtilization: number;
  throughput: number;
  totalDuration: number;
};

export type SimulationProcessResult = {
  pid: string;
  arrivalTime: number;
  burstTime: number;
  priority: number;
  memoryMb: number;
  startTime: number;
  completionTime: number;
  waitingTime: number;
  turnaroundTime: number;
  responseTime: number;
};

export type SimulationSegment = {
  pid: string;
  start: number;
  end: number;
  kind: "process" | "idle";
};

export const simulationsTable = pgTable("adaptiveos_simulations", {
  id: serial("id").primaryKey(),
  workloadId: integer("workload_id")
    .notNull()
    .references(() => workloadsTable.id, { onDelete: "cascade" }),
  algorithmId: text("algorithm_id").notNull(),
  algorithmName: text("algorithm_name").notNull(),
  quantum: doublePrecision("quantum"),
  metrics: jsonb("metrics").$type<SimulationMetrics>().notNull(),
  processes: jsonb("processes").$type<SimulationProcessResult[]>().notNull(),
  timeline: jsonb("timeline").$type<SimulationSegment[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const recommendationsTable = pgTable("adaptiveos_recommendations", {
  id: serial("id").primaryKey(),
  workloadId: integer("workload_id")
    .notNull()
    .references(() => workloadsTable.id, { onDelete: "cascade" }),
  objective: text("objective").notNull(),
  recommendation: jsonb("recommendation").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
