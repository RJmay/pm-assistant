<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import DraftRow from "$lib/components/DraftRow.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { ShieldCheck } from "lucide-svelte";
  import { onMount } from "svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  onMount(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("alerts-ai-drafts")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_drafts" }, () => {
        void invalidateAll();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  });
</script>

<svelte:head><title>Alerts · PM Assistant</title></svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Alerts"
    description="Escalations, emergency landlord alerts, safety-critical issues, and do-not-send drafts."
  >
    {#snippet actions()}
      <span
        class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--muted-foreground))]"
      >
        {data.items.length} active
      </span>
    {/snippet}
  </PageHeader>

  {#if data.items.length === 0}
    <EmptyState
      icon={ShieldCheck}
      title="No active alerts"
      description="Escalated drafts, emergency alerts and safety-critical issues will surface here."
    />
  {:else}
    <div class="space-y-2">
      {#each data.items as item (item.id)}
        <DraftRow {item} />
      {/each}
    </div>
  {/if}
</div>
