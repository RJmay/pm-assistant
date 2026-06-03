<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { relativeTime } from "$lib/format";
  import { ArrowLeft } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function dollars(cents?: number): string {
    return cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;
  }
</script>

<svelte:head><title>Maintenance job · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <a
    href="/maintenance"
    class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft class="h-4 w-4" /> Back to maintenance
  </a>

  <div class="flex flex-wrap items-center gap-2">
    <Badge variant={data.job.classification === "emergency" ? "destructive" : "secondary"}>
      {data.job.classification}
    </Badge>
    <Badge variant="outline">{data.job.state}</Badge>
    {#if data.job.trade}<Badge variant="outline">{data.job.trade}</Badge>{/if}
    <Badge variant="secondary">owner approval: {data.job.owner_approval_state}</Badge>
  </div>

  <Card>
    <CardHeader><CardTitle class="text-base">{data.job.issue}</CardTitle></CardHeader>
    <CardContent class="space-y-1 text-sm">
      <p>
        <span class="text-muted-foreground">Property:</span>
        {data.job.property_address ?? "Not matched"}
      </p>
      <p><span class="text-muted-foreground">Created:</span> {relativeTime(data.job.created_at)}</p>
      {#if data.job.scheduled_for}
        <p>
          <span class="text-muted-foreground">Scheduled:</span>
          {relativeTime(data.job.scheduled_for)}
        </p>
      {/if}
      {#if data.job.source_draft_id}
        <p>
          <a class="text-primary hover:underline" href={`/queue/${data.job.source_draft_id}`}>
            View originating request →
          </a>
        </p>
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader><CardTitle class="text-base">Quotes</CardTitle></CardHeader>
    <CardContent class="space-y-2">
      {#if data.job.quotes.length === 0}
        <p class="text-sm text-muted-foreground">No quote requests yet.</p>
      {:else}
        {#each data.job.quotes as quote (quote.id)}
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{quote.tradie_name}</span>
              <Badge variant="outline">{quote.status}</Badge>
            </div>
            <div class="flex items-center gap-3 text-muted-foreground">
              <span>{dollars(quote.amount_cents)}</span>
              {#if quote.draft_id}
                <a class="text-primary hover:underline" href={`/queue/${quote.draft_id}`}>draft →</a>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </CardContent>
  </Card>
</div>

<style></style>
