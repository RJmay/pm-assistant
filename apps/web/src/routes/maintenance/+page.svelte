<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { relativeTime } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Maintenance · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-xl font-semibold">Maintenance jobs</h1>
    <p class="text-sm text-muted-foreground">
      Jobs created from maintenance requests. Quote requests and approval messages appear in your
      review queue to send.
    </p>
  </div>

  {#if data.jobs.length === 0}
    <p class="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      No maintenance jobs yet. Open a maintenance request in the queue and choose “Create
      maintenance job”.
    </p>
  {:else}
    <div class="space-y-2">
      {#each data.jobs as job (job.id)}
        <a
          href={`/maintenance/${job.id}`}
          class="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant={job.classification === "emergency" ? "destructive" : "secondary"}>
                  {job.classification}
                </Badge>
                <Badge variant="outline">{job.state}</Badge>
                {#if job.trade}<Badge variant="outline">{job.trade}</Badge>{/if}
                {#if job.owner_approval_state !== "not_required"}
                  <Badge variant="outline">owner: {job.owner_approval_state}</Badge>
                {/if}
              </div>
              <p class="mt-2 truncate font-medium">{job.issue}</p>
              <p class="truncate text-sm text-muted-foreground">
                {job.property_address ?? "Property not matched"}
              </p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1.5 text-xs text-muted-foreground">
              <span>{relativeTime(job.created_at)}</span>
              <span>{job.quote_count} quote{job.quote_count === 1 ? "" : "s"}</span>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style></style>
