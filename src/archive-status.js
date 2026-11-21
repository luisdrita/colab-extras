class ArchiveStatusUnavailable extends Error {}

// ZIP and extraction workers publish status.json atomically in their own job directory.
async function* archiveJobStatuses(job) {
  const ctx = job.ctx;
  const url = '/files/' + encodePath(job.dir + '/status.json');
  let receivedStatus = false;
  let startupMisses = 0;
  let consecutiveReadErrors = 0;
  let cancelRequested = false;

  while (true) {
    await sleep(750);
    if (job.cancelled && !cancelRequested) {
      cancelRequested = true;
      try {
        await put(ctx, job.dir + '/cancel', 'cancel');
      } catch {
        // The marker may have arrived, or the worker may already have finished.
        setStatus(job, 'Checking cancellation…', 'Waiting for the worker to confirm its outcome.');
      }
    }

    let result;
    try {
      const response = await request(ctx, url + '?t=' + Date.now());
      result = await response.json();
      assertRuntime(ctx);
    } catch (error) {
      if (ctx.kernel.runtime !== ctx.runtime) {
        throw new ArchiveStatusUnavailable('The runtime changed.');
      }
      if (error.status === 404 && !receivedStatus) {
        // Allow the worker time to start without spending its recovery attempts.
        if (++startupMisses < 30) continue;
      } else {
        const transient = !error.status || [404, 408, 429].includes(error.status) || error.status >= 500;
        if (transient && ++consecutiveReadErrors <= 2) {
          setStatus(job, 'Rechecking status…', 'Waiting for the existing job’s status.');
          continue;
        }
      }
      throw new ArchiveStatusUnavailable(error.message || 'Colab could not read the job status.');
    }

    receivedStatus = true;
    consecutiveReadErrors = 0;
    yield result;
  }
}
