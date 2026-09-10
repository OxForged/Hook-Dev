import { Queue, QueueEvents, type JobsOptions } from "bullmq";
import { env } from "../config/env.js";
import { queueRedis } from "../cache/redis.js";

/**
 * Job definitions.
 *
 * One queue, two job names:
 *
 *   poll     — repeatable; reads from each chain's cursor to the safe head.
 *   backfill — one-off; re-reads an explicit block range. Idempotent, because
 *              every write in the ingestion repository is an upsert or a
 *              `createMany({ skipDuplicates: true })`.
 *
 * Both run the same ingestion pass; they differ only in how the window is
 * chosen. That keeps the "catch up" and "repair" paths from drifting apart.
 */

export const INGESTION_QUEUE = "ingestion";

export interface PollJobData {
  chainId: number;
}

export interface BackfillJobData {
  chainId: number;
  fromBlock?: string;
  toBlock?: string;
  force?: boolean;
}

export type IngestionJobData = PollJobData | BackfillJobData;

export const JOB_NAMES = {
  poll: "poll",
  backfill: "backfill",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  // Keep a short tail for debugging without letting Redis grow unbounded.
  removeOnComplete: { count: 200, age: 24 * 3_600 },
  removeOnFail: { count: 500, age: 7 * 24 * 3_600 },
};

let queue: Queue<IngestionJobData> | undefined;

export function ingestionQueue(): Queue<IngestionJobData> {
  queue ??= new Queue<IngestionJobData>(INGESTION_QUEUE, {
    connection: queueRedis,
    prefix: env.BULLMQ_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return queue;
}

let events: QueueEvents | undefined;

export function ingestionQueueEvents(): QueueEvents {
  events ??= new QueueEvents(INGESTION_QUEUE, {
    connection: queueRedis.duplicate(),
    prefix: env.BULLMQ_PREFIX,
  });
  return events;
}

/**
 * Job ids may not contain `:` — BullMQ reserves it as its own key separator and
 * rejects the job outright. Hence `-` everywhere below.
 */
function backfillJobId(data: BackfillJobData): string {
  return ["backfill", data.chainId, data.fromBlock ?? "cursor", data.toBlock ?? "head"].join("-");
}

export function pollSchedulerId(chainId: number): string {
  return `poll-${chainId}`;
}

/**
 * Enqueue a one-off backfill.
 *
 * The job id is derived from the window, so requesting the same range twice
 * while the first is still pending collapses into one job rather than queuing
 * duplicate work.
 */
export async function enqueueBackfill(data: BackfillJobData) {
  return ingestionQueue().add(JOB_NAMES.backfill, data, { jobId: backfillJobId(data) });
}

/**
 * Register (or refresh) the repeatable poll job for a chain.
 *
 * `upsertJobScheduler` is idempotent on the scheduler id, so restarting the
 * worker refreshes the schedule instead of accumulating duplicates.
 */
export async function scheduleChainPoll(chainId: number, everyMs: number) {
  return ingestionQueue().upsertJobScheduler(
    pollSchedulerId(chainId),
    { every: everyMs },
    {
      name: JOB_NAMES.poll,
      data: { chainId },
      opts: { removeOnComplete: { count: 50 } },
    },
  );
}

export async function removeChainPoll(chainId: number): Promise<void> {
  // A scheduler that is not registered is not an error worth failing on.
  await ingestionQueue()
    .removeJobScheduler(pollSchedulerId(chainId))
    .catch(() => false);
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([queue?.close(), events?.close()]);
  queue = undefined;
  events = undefined;
}
