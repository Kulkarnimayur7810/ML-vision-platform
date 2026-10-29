import { sql } from "../db";
import { reconcileStale } from "./training";

export type MlSummary = {
  datasets: number; images: number; approved: number; labeled: number; versions: number;
  runs: { total: number; running: number; queued: number; completed: number; failed: number };
  models: { total: number; selected: { name: string; number: number; testScore: number | null; valScore: number | null; metric: string } | null };
  latest: { id: string; number: number; name: string; taskType: string; valScore: number | null; testScore: number | null; metric: string } | null;
  worker: { online: boolean; queued: number };
  next: { text: string; href: string };
};

/** Every number here is counted or read from stored results. Missing results stay null — nothing is estimated. */
export async function mlSummary(workspaceId: string, slug: string): Promise<MlSummary> {
  await reconcileStale(workspaceId);
  const [d] = await sql()`select count(distinct ds.id)::int datasets, count(i.id)::int images, count(i.id) filter (where i.status = 'approved')::int approved, count(i.id) filter (where i.status in ('labeled','approved'))::int labeled,
      (select count(*)::int from dataset_versions v join datasets d2 on d2.id = v.dataset_id where d2.workspace_id = ${workspaceId} and d2.archived_at is null) versions
    from datasets ds left join dataset_images i on i.dataset_id = ds.id where ds.workspace_id = ${workspaceId} and ds.archived_at is null`;
  const [r] = await sql()`select count(*)::int total, count(*) filter (where status = 'running')::int running, count(*) filter (where status = 'queued')::int queued, count(*) filter (where status = 'completed')::int completed, count(*) filter (where status in ('failed','interrupted'))::int failed from training_runs where workspace_id = ${workspaceId}`;
  const [m] = await sql()`select count(*)::int total from model_versions where workspace_id = ${workspaceId} and stage <> 'archived'`;
  const score = (task: string, val: Record<string, number> | null, test: Record<string, number> | null) => task === "detect"
    ? { metric: "mAP@50", val: val?.["metrics/mAP50(B)"] ?? null, test: test?.map50 ?? null } : { metric: "top-1", val: val?.["metrics/accuracy_top1"] ?? null, test: test?.top1 ?? null };
  const [sel] = await sql()`select m.name, m.number, m.task_type, r.best_metrics, (select e.metrics from evaluations e where e.run_id = m.run_id and e.split = 'test' and e.status = 'completed' order by e.created_at desc limit 1) test
    from model_versions m join training_runs r on r.id = m.run_id where m.workspace_id = ${workspaceId} and m.stage = 'selected' order by m.created_at desc limit 1`;
  const [lat] = await sql()`select r.id, r.number, r.name, r.task_type, r.best_metrics, (select e.metrics from evaluations e where e.run_id = r.id and e.split = 'test' and e.status = 'completed' order by e.created_at desc limit 1) test
    from training_runs r where r.workspace_id = ${workspaceId} and r.status = 'completed' order by r.finished_at desc nulls last limit 1`;
  const [w] = await sql()`select exists (select 1 from workers where last_seen > now() - interval '60 seconds') online, (select count(*)::int from worker_jobs where workspace_id = ${workspaceId} and status = 'queued') queued`;
  const s = sel ? score(sel.task_type, sel.best_metrics, sel.test) : null;
  const l = lat ? score(lat.task_type, lat.best_metrics, lat.test) : null;
  const next = d.datasets === 0 ? { text: "Create your first dataset.", href: `/w/${slug}/datasets` }
    : d.images === 0 ? { text: "Upload photos to a dataset.", href: `/w/${slug}/datasets` }
    : d.labeled < d.images ? { text: `Label the remaining ${d.images - d.labeled} image(s).`, href: `/w/${slug}/annotate` }
    : d.approved < 3 ? { text: "Review and approve labeled images (at least 3 to make a version).", href: `/w/${slug}/annotate` }
    : d.versions === 0 ? { text: "Create a dataset version to freeze labels and split the data.", href: `/w/${slug}/datasets` }
    : r.total === 0 ? { text: "Start a first training run (a Quick test is a good check).", href: `/w/${slug}/training/new` }
    : r.completed > 0 && (!lat || !lat.test) ? { text: "Evaluate your latest run on the test split.", href: `/w/${slug}/training/${lat?.id ?? ""}` }
    : m.total === 0 && r.completed > 0 ? { text: "Register the model you want to keep.", href: `/w/${slug}/models` }
    : { text: "Compare runs in Experiments, or document your results.", href: `/w/${slug}/experiments` };
  return {
    datasets: d.datasets, images: d.images, approved: d.approved, labeled: d.labeled, versions: d.versions,
    runs: { total: r.total, running: r.running, queued: r.queued, completed: r.completed, failed: r.failed },
    models: { total: m.total, selected: sel && s ? { name: sel.name, number: sel.number, metric: s.metric, valScore: s.val, testScore: s.test } : null },
    latest: lat && l ? { id: lat.id, number: lat.number, name: lat.name, taskType: lat.task_type, metric: l.metric, valScore: l.val, testScore: l.test } : null,
    worker: { online: !!w.online, queued: w.queued }, next,
  };
}
