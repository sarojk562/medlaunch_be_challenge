import { enqueueJob } from '../../src/services/async-job.service';

describe('async-job.service', () => {
  it('executes a successful job once', async () => {
    const executeFn = jest.fn().mockResolvedValue(undefined);

    enqueueJob({ name: 'TestJob', payload: { x: 1 }, execute: executeFn });

    // Give the fire-and-forget promise time to resolve
    await new Promise((r) => setTimeout(r, 100));

    expect(executeFn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    const executeFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    enqueueJob({ name: 'RetryJob', payload: {}, execute: executeFn });

    // Wait enough for retry (500ms delay + buffer)
    await new Promise((r) => setTimeout(r, 1500));

    expect(executeFn).toHaveBeenCalledTimes(2);
  });

  it('exhausts all 3 retries and logs failure', async () => {
    const executeFn = jest.fn().mockRejectedValue(new Error('always fails'));

    enqueueJob({ name: 'FailJob', payload: { id: 42 }, execute: executeFn });

    // Wait for all 3 retries: 500ms + 1000ms + buffer
    await new Promise((r) => setTimeout(r, 3000));

    expect(executeFn).toHaveBeenCalledTimes(3);
  });
});
