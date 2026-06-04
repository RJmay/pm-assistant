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
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type DocType =
    | "entry_notice"
    | "rent_increase_notice"
    | "notice_to_remedy_breach"
    | "notice_to_leave";
  let docType = $state<DocType>("entry_notice");
  let tenancyId = $state("");
  let entryDate = $state("");
  let entryWindow = $state("");
  let newRent = $state("");
  let effectiveDate = $state("");
  let amountOwed = $state("");
  let ground = $state<"unremedied_breach" | "end_of_fixed_term">("end_of_fixed_term");
  let busy = $state(false);

  const typeLabels: Record<string, string> = {
    entry_notice: "Entry notice (Form 9)",
    rent_increase_notice: "Rent-increase notice",
    notice_to_remedy_breach: "Notice to remedy breach (Form 11)",
    notice_to_leave: "Notice to leave (Form 12)",
  };

  async function generate() {
    if (!tenancyId) {
      toast.error("Pick a tenancy.");
      return;
    }
    const workerUrl = env.PUBLIC_WORKER_URL;
    if (!workerUrl) {
      toast.error("PUBLIC_WORKER_URL is not configured.");
      return;
    }
    // biome-ignore lint/suspicious/noExplicitAny: discriminated payload built per type
    const body: Record<string, any> = { type: docType, tenancyId };
    if (docType === "entry_notice") {
      if (entryDate) body.entryDate = entryDate;
      if (entryWindow.trim()) body.entryWindow = entryWindow.trim();
    } else if (docType === "rent_increase_notice") {
      const cents = Math.round(Number.parseFloat(newRent) * 100);
      if (!Number.isFinite(cents) || cents <= 0) {
        toast.error("Enter the new rent.");
        return;
      }
      body.newRentCents = cents;
      if (effectiveDate) body.effectiveDate = effectiveDate;
    } else if (docType === "notice_to_remedy_breach") {
      const cents = Math.round(Number.parseFloat(amountOwed) * 100);
      if (!Number.isFinite(cents) || cents <= 0) {
        toast.error("Enter the amount owing.");
        return;
      }
      body.amountOwedCents = cents;
    } else {
      body.ground = ground;
    }

    busy = true;
    try {
      const supabase = getBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${workerUrl}/api/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Document generated.");
        await invalidateAll();
      } else {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(detail?.error ? detail.error : `Failed (${res.status}).`);
      }
    } catch {
      toast.error("Could not reach the Worker.");
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Documents · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-xl font-semibold">Documents</h1>
    <p class="text-sm text-muted-foreground">
      Generate QLD statutory documents. Dates and notice periods come from the compliance rules
      engine — the system won't generate a document that wouldn't be compliant.
    </p>
  </div>

  <Card>
    <CardHeader><CardTitle class="text-base">Generate a document</CardTitle></CardHeader>
    <CardContent class="space-y-3">
      {#if data.tenancies.length === 0}
        <p class="text-sm text-muted-foreground">No active tenancies to generate documents for.</p>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="type">Document</Label>
            <select
              id="type"
              bind:value={docType}
              class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="entry_notice">Entry notice (Form 9)</option>
              <option value="rent_increase_notice">Rent-increase notice</option>
              <option value="notice_to_remedy_breach">Notice to remedy breach (Form 11)</option>
              <option value="notice_to_leave">Notice to leave (Form 12)</option>
            </select>
          </div>
          <div class="space-y-1.5">
            <Label for="tenancy">Tenancy</Label>
            <select
              id="tenancy"
              bind:value={tenancyId}
              class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="" disabled>Select…</option>
              {#each data.tenancies as t (t.id)}
                <option value={t.id}>{t.label}</option>
              {/each}
            </select>
          </div>

          {#if docType === "entry_notice"}
            <div class="space-y-1.5">
              <Label for="entrydate">Entry date (optional — earliest compliant if blank)</Label>
              <Input id="entrydate" type="date" bind:value={entryDate} />
            </div>
            <div class="space-y-1.5">
              <Label for="entrywindow">Entry window (optional)</Label>
              <Input id="entrywindow" bind:value={entryWindow} placeholder="e.g. 9:00am–11:00am" />
            </div>
          {:else if docType === "rent_increase_notice"}
            <div class="space-y-1.5">
              <Label for="newrent">New rent ($)</Label>
              <Input id="newrent" bind:value={newRent} placeholder="e.g. 620" />
            </div>
            <div class="space-y-1.5">
              <Label for="effdate">Effective date (optional — earliest compliant if blank)</Label>
              <Input id="effdate" type="date" bind:value={effectiveDate} />
            </div>
          {:else if docType === "notice_to_remedy_breach"}
            <div class="space-y-1.5">
              <Label for="owed">Amount owing ($)</Label>
              <Input id="owed" bind:value={amountOwed} placeholder="e.g. 1160" />
            </div>
          {:else}
            <div class="space-y-1.5">
              <Label for="ground">Ground</Label>
              <select
                id="ground"
                bind:value={ground}
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="end_of_fixed_term">End of fixed term</option>
                <option value="unremedied_breach">Rent not paid (breach not remedied)</option>
              </select>
            </div>
          {/if}
        </div>
        <Button disabled={busy} onclick={generate}>
          {busy ? "Generating…" : "Generate document"}
        </Button>
      {/if}
    </CardContent>
  </Card>

  {#if data.documents.length > 0}
    <div class="space-y-2">
      {#each data.documents as doc (doc.id)}
        <a
          href={`/documents/${doc.id}`}
          class="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium">{doc.title}</span>
              {#if doc.form_id}<Badge variant="outline">Form {doc.form_id}</Badge>{/if}
            </div>
            <p class="text-sm text-muted-foreground">{typeLabels[doc.type] ?? doc.type}</p>
          </div>
          <span class="shrink-0 text-xs text-muted-foreground">{relativeTime(doc.created_at)}</span>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style></style>
