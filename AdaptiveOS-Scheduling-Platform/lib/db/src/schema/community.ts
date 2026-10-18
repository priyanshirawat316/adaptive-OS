import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { simulationsTable } from "./simulations";

export const sharedMetricsTable = pgTable("adaptiveos_shared_metrics", {
  id: serial("id").primaryKey(),
  simulationId: integer("simulation_id")
    .notNull()
    .unique()
    .references(() => simulationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  authorName: text("author_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const communityAlgorithmsTable = pgTable("adaptiveos_community_algorithms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  authorName: text("author_name").notNull(),
  sourceCode: text("source_code").notNull(),
  tags: text("tags").array().notNull().default([]),
  status: text("status").notNull().default("review-unexecuted"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const discussionsTable = pgTable("adaptiveos_discussions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  authorName: text("author_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const communityCommentsTable = pgTable("adaptiveos_community_comments", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  authorName: text("author_name").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
