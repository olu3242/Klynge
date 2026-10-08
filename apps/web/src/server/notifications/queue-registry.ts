import type { MemoryAccountStore } from "../account/memory-account-store.ts";
import { MemoryNotificationQueue } from "./worker.ts";

/** One in-process queue (and lease map) per account store, shared by the cron route and operator monitoring. */
const queues = new WeakMap<MemoryAccountStore, MemoryNotificationQueue>();
export function memoryQueueFor(account: MemoryAccountStore): MemoryNotificationQueue {
  let q = queues.get(account);
  if (!q) queues.set(account, (q = new MemoryNotificationQueue(account)));
  return q;
}
