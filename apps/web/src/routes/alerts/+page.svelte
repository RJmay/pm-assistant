<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import DraftRow from "$lib/components/DraftRow.svelte";
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

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-semibold tracking-tight">Alerts</h1>
    <span class="text-sm text-muted-foreground">{data.items.length}</span>
  </div>
  <p class="text-sm text-muted-foreground">
    Escalations, emergency landlord alerts, safety-critical issues, and do-not-send drafts.
  </p>

  {#if data.items.length === 0}
    <div
      class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center"
    >
      <ShieldCheck class="h-8 w-8 text-muted-foreground" />
      <p class="font-medium">No active alerts</p>
      <p class="text-sm text-muted-foreground">Escalated drafts will surface here.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each data.items as item (item.id)}
        <DraftRow {item} />
      {/each}
    </div>
  {/if}
</div>
