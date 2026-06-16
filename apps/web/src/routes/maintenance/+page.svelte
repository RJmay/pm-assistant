<script lang="ts">
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { jobStateLabel, ownerApprovalLabel, relativeTime } from "$lib/format";
  import { Wrench } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Maintenance · PM Assistant</title></svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Maintenance jobs"
    description="Jobs created from maintenance requests. Quote requests and approval messages appear in your review queue to send."
  >
    {#snippet actions()}
      <span
        class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--muted-foreground))]"
      >
        {data.jobs.length} job{data.jobs.length === 1 ? "" : "s"}
      </span>
    {/snippet}
  </PageHeader>

  {#if data.jobs.length === 0}
    <EmptyState
      icon={Wrench}
      title="No maintenance jobs yet"
      description="Open a maintenance request in the queue and choose “Create maintenance job” to start one."
    />
  {:else}
    <div class="space-y-2">
      {#each data.jobs as job (job.id)}
        <a
          href={`/maintenance/${job.id}`}
          class="block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm transition-all hover:-translate-y-px hover:border-[hsl(var(--brand)/0.4)] hover:shadow-md"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant={job.classification === "emergency" ? "destructive" : "secondary"}>
                  {job.classification === "emergency" ? "Emergency" : job.classification === "routine" ? "Routine" : "Other"}
                </Badge>
                <Badge variant="outline">{jobStateLabel(job.state)}</Badge>
                {#if job.trade}<Badge variant="outline">{job.trade}</Badge>{/if}
                {#if job.owner_approval_state !== "not_required"}
                  <Badge variant="outline">Owner: {ownerApprovalLabel(job.owner_approval_state)}</Badge>
                {/if}
              </div>
              <p class="mt-2 truncate font-semibold">{job.issue}</p>
              <p class="truncate text-sm text-[hsl(var(--muted-foreground))]">
                {job.property_address ?? "Property not matched"}
              </p>
            </div>
            <div
              class="flex shrink-0 flex-col items-end gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"
            >
              <span class="tabular-nums">{relativeTime(job.created_at)}</span>
              <span class="tabular-nums">{job.quote_count} quote{job.quote_count === 1 ? "" : "s"}</span>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
