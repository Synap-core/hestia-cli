/**
 * In-memory render job store.
 *
 * A render is CPU-bound and runs for minutes, so `POST /render` returns a job id
 * immediately and the caller polls. This is not an optimisation — the Synap
 * capability declares `executionMode: async` with a 300s timeout and tells the
 * agent to poll, so a synchronous service would fail the contract.
 *
 * ⚠️ IN-MEMORY ON PURPOSE. The store dies with the container, and a job lost that
 * way MUST read as `failed`, never as still-rendering: a caller polling a job id
 * that can never resolve would hang forever. `statusOf` therefore reports a missing
 * job as a terminal `failed` with an explanatory error, which is a fact the caller
 * can act on, rather than a 404 it has to interpret.
 *
 * Bounded + TTL-evicted so a long-lived renderer cannot accumulate jobs.
 */

import { randomUUID } from "node:crypto";

/**
 * Job lifecycle. `queued → rendering → done | failed`.
 *
 * `failed` is TERMINAL and covers every non-success: an unknown composition, a
 * render that threw, or a job evicted/lost. There is deliberately no `stuck`
 * state — a job that cannot progress is `failed` with a reason.
 */
export const JOB_STATUSES = /** @type {const} */ ([
  "queued",
  "rendering",
  "done",
  "failed",
]);

/** @typedef {(typeof JOB_STATUSES)[number]} JobStatus */

export class JobStore {
  /**
   * @param {{ maxJobs?: number, ttlMs?: number }} [opts]
   */
  constructor(opts = {}) {
    /** @type {Map<string, { jobId: string, status: JobStatus, progress: number, outputPath: string | null, durationFrames: number | null, error: string | null, createdAt: number, updatedAt: number }>} */
    this.jobs = new Map();
    this.maxJobs = opts.maxJobs ?? 100;
    this.ttlMs = opts.ttlMs ?? 60 * 60 * 1000; // 1h
  }

  /** Create a job in `queued`. */
  create() {
    this.#evict();
    const jobId = randomUUID();
    const now = Date.now();
    this.jobs.set(jobId, {
      jobId,
      status: "queued",
      progress: 0,
      outputPath: null,
      durationFrames: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    return jobId;
  }

  /**
   * The exact shape the capability's `remotion_get_render_status` maps. Every
   * field it reads is present here, so the skill never has to guess a key.
   */
  get(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      // A job the store cannot produce a record for has not rendered, will not
      // render, and never will. Reporting that as `failed` is the honest answer.
      return {
        jobId,
        status: /** @type {const} */ ("failed"),
        progress: 0,
        outputPath: null,
        durationFrames: null,
        error:
          "Unknown or expired render job. The renderer may have restarted; " +
          "start the render again.",
      };
    }
    return {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      outputPath: job.outputPath,
      durationFrames: job.durationFrames,
      error: job.error,
    };
  }

  /**
   * Merge a partial update. Only known fields move; `progress` is clamped 0..100
   * because a renderer reporting 105% should not be able to render a broken bar.
   */
  update(jobId, patch) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (patch.status !== undefined) job.status = patch.status;
    if (patch.progress !== undefined) {
      const n = Number(patch.progress);
      if (Number.isFinite(n)) job.progress = Math.max(0, Math.min(100, n));
    }
    if (patch.outputPath !== undefined) job.outputPath = patch.outputPath;
    if (patch.durationFrames !== undefined) job.durationFrames = patch.durationFrames;
    if (patch.error !== undefined) job.error = patch.error;
    job.updatedAt = Date.now();
    return job;
  }

  /** Drop the oldest finished jobs past `maxJobs`, then anything past TTL. */
  #evict() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.updatedAt > this.ttlMs) this.jobs.delete(id);
    }
    if (this.jobs.size < this.maxJobs) return;
    // Oldest-first among TERMINAL jobs only — a rendering job is never evicted,
    // because its caller is still polling and would see a job vanish mid-flight.
    const terminal = [...this.jobs.values()]
      .filter((j) => j.status === "done" || j.status === "failed")
      .sort((a, b) => a.updatedAt - b.updatedAt);
    let excess = this.jobs.size - this.maxJobs + 1;
    for (const job of terminal) {
      if (excess-- <= 0) break;
      this.jobs.delete(job.jobId);
    }
  }
}
