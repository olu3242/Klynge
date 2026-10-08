import "server-only";
import { RpcNotificationQueue } from "../notifications/worker.ts";
import { serviceRoleClient } from "./service-role.ts";

/** Hosted notification queue for the scheduled worker. Uses ONLY the allow-listed "notifications.dispatch" operation. */
export function hostedNotificationQueue(env: Readonly<Record<string, string | undefined>> = process.env): RpcNotificationQueue {
  const db = serviceRoleClient("notifications.dispatch", env);
  return new RpcNotificationQueue(
    async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new Error(`notification worker: ${fn} failed (${error.code ?? "unknown"})`);
      return Array.isArray(data) ? (data as Record<string, unknown>[]) : [{ value: data }];
    },
    async (table, row) => {
      const { error } = await db.from(table).insert(row);
      if (error && error.code !== "23505") throw new Error(`notification worker: insert into ${table} failed (${error.code ?? "unknown"})`);
    },
  );
}
