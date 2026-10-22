// worker_threads bootstrap: the default home for background work in a
// single-process deployment. index.ts spawns this thread so queue workers,
// the DB-job runner, and maintenance sweeps run OFF the main event loop —
// an HTTP request can never be starved by a CPU-heavy job (zip building,
// export serialization, pdf parsing), and the seam to a fully separate
// worker process/machine (src/worker.ts) stays identical.


// the API process's init does not cover errors thrown in here.

import { parentPort } from "node:worker_threads";
import { startAllWorkers, stopAllWorkers } from "./workerRuntime";
import { flushDiagnostics, reportError } from "./lib/observability/diagnostics";

startAllWorkers();
console.log("[worker-thread] background workers started");

parentPort?.on("message", (message: unknown) => {
    if (message === "shutdown") {
        void stopAllWorkers()
            .catch((err) => {
                reportError(err, { tags: { component: "worker-thread" } });
                console.error("[worker-thread] shutdown error", err);
            })
            .then(() => flushDiagnostics())
            .finally(() => process.exit(0));
    }
});
