/**
 * Simple concurrency limiter to prevent too many simultaneous FFmpeg processes.
 */
const MAX_CONCURRENT = 3;
let running = 0;
const queue: Array<() => void> = [];

export function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (running < MAX_CONCURRENT) {
      running++;
      resolve();
    } else {
      queue.push(() => {
        running++;
        resolve();
      });
    }
  });
}

export function releaseSlot(): void {
  running--;
  const next = queue.shift();
  if (next) next();
}

export function getStats() {
  return { running, queued: queue.length, max: MAX_CONCURRENT };
}
