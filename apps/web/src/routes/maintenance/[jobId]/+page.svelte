<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { toast } from "$lib/components/ui/sonner";
  import { relativeTime } from "$lib/format";
  import { env } from "$lib/public-env";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { ArrowLeft } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let amounts = $state<Record<string, string>>({});
  let estimate = $state("");
  let busy = $state(false);

  function dollars(cents?: number): string {
    return cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;
  }
  function toCents(dollarsStr: string): number | undefined {
    const n = Number.parseFloat(dollarsStr);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  }

  async function callWorker(path: string, body: unknown): Promise<boolean> {
    const workerUrl = env.PUBLIC_WORKER_URL;
    if (!workerUrl) {
      toast.error("PUBLIC_WORKER_URL is not configured.");
      return false;
    }
    busy = true;
    try {
      const supabase = getBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${workerUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await invalidateAll();
        return true;
      }
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(detail?.error ? detail.error : `Request failed (${res.status}).`);
      return false;
    } catch {
      toast.error("Could not reach the Worker.");
      return false;
    } finally {
      busy = false;
    }
  }

  async function recordQuote(quoteId: string) {
    const cents = toCents(amounts[quoteId] ?? "");
    if (cents == null) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (await callWorker(`/api/maintenance/jobs/${data.job.id}/quotes/${quoteId}`, { amountCents: cents })) {
      toast.success("Quote recorded.");
      amounts[quoteId] = "";
    }
  }

  async function requestApproval() {
    const body: { estimateCents?: number } = {};
    const cents = toCents(estimate);
    if (cents != null) body.estimateCents = cents;
    if (await callWorker(`/api/maintenance/jobs/${data.job.id}/owner-approval`, body)) {
      toast.success("Owner-approval request drafted — review it in the queue.");
      estimate = "";
    }
  }

  async function decide(decision: "approved" | "declined") {
    if (await callWorker(`/api/maintenance/jobs/${data.job.id}/decision`, { decision })) {
      toast.success(`Marked ${decision}.`);
    }
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
      {#if data.job.approved_spend_cents != null}
        <p>
          <span class="text-muted-foreground">Approved spend:</span>
          {dollars(data.job.approved_spend_cents)}
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
              {#if quote.chased_at}<Badge variant="secondary">chased</Badge>{/if}
            </div>
            <div class="flex items-center gap-2 text-muted-foreground">
              <span>{dollars(quote.amount_cents)}</span>
              {#if quote.draft_id}
                <a class="text-primary hover:underline" href={`/queue/${quote.draft_id}`}>draft →</a>
              {/if}
              <Input
                bind:value={amounts[quote.id]}
                placeholder="amount $"
                class="h-8 w-28"
              />
              <Button size="sm" variant="outline" disabled={busy} onclick={() => recordQuote(quote.id)}>
                Record
              </Button>
            </div>
          </div>
        {/each}
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader><CardTitle class="text-base">Owner approval</CardTitle></CardHeader>
    <CardContent class="space-y-3">
      {#if data.job.owner_approval_state === "pending"}
        <p class="text-sm text-muted-foreground">
          An approval request has been drafted for the owner. Once they reply, record their decision:
        </p>
        <div class="flex gap-2">
          <Button disabled={busy} onclick={() => decide("approved")}>Mark approved</Button>
          <Button variant="destructive" disabled={busy} onclick={() => decide("declined")}>
            Mark declined
          </Button>
        </div>
      {:else if data.job.owner_approval_state === "approved"}
        <p class="text-sm text-muted-foreground">Owner has approved this job.</p>
      {:else if data.job.owner_approval_state === "declined"}
        <p class="text-sm text-muted-foreground">Owner declined. Re-quote or close the job.</p>
      {:else}
        <p class="text-sm text-muted-foreground">
          If the cost is above the routine spend you handle, draft an approval request for the owner.
          Leave the estimate blank to use the lowest recorded quote.
        </p>
        <div class="flex flex-wrap items-end gap-2">
          <div class="space-y-1.5">
            <Label for="estimate">Estimate (optional)</Label>
            <Input id="estimate" bind:value={estimate} placeholder="amount $" class="w-40" />
          </div>
          <Button disabled={busy} onclick={requestApproval}>Request owner approval</Button>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>

<style></style>
