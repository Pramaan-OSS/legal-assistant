
import { createServerSupabase } from "../lib/supabase";
import { flushDiagnostics, reportError } from "../lib/observability/diagnostics";
import { syncWorkflowCatalog } from "../lib/workflowCatalogSync";

async function main() {
  const result = await syncWorkflowCatalog(createServerSupabase());
  console.log(
    `Synced ${result.workflows} Legal Assistant workflows and ${result.assets} assets from ${result.sourceCommit}`,
  );
}

void main().catch(async (error) => {
  reportError(error, { tags: { component: "workflow-sync" }, level: "fatal" });
  console.error("Legal Assistant workflow sync failed", error);
  await flushDiagnostics();
  process.exit(1);
});
