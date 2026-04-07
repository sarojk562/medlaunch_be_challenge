import { logger } from '../utils/logger';

interface AsyncJob {
  name: string;
  payload: unknown;
  execute: () => Promise<void>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function enqueueJob(job: AsyncJob): void {
  // Fire-and-forget — runs in the background
  void runWithRetry(job);
}

async function runWithRetry(job: AsyncJob): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info({ job: job.name, attempt }, 'Executing async job');
      await job.execute();
      logger.info({ job: job.name }, 'Async job completed successfully');
      return;
    } catch (err) {
      logger.warn({ job: job.name, attempt, err }, 'Async job failed');

      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  logger.error({ job: job.name, payload: job.payload }, 'Async job exhausted all retries');
}
