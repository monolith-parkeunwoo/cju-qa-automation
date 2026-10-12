import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    requestKey: text("request_key").notNull(),
    input: text("input").notNull(),
    profileVersion: text("profile_version").notNull(),
    profile: text("profile_snapshot"),
    status: text("status").notNull(),
    step: integer("step").notNull().default(0),
    orderId: text("order_id"),
    reservationId: text("reservation_id"),
    checks: text("checks"),
    reason: text("reason"),
    token: text("token"),
    slot: integer("slot"),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [
    uniqueIndex("dedupe").on(t.owner, t.requestKey),
    uniqueIndex("single_active_run").on(t.slot),
  ],
);
export const runner = sqliteTable("runner", {
  id: integer("id").primaryKey(),
  profile: text("profile").notNull(),
  seen: integer("seen").notNull(),
});
