<script lang="ts">
  import PropertyRow from "$lib/components/PropertyRow.svelte";
  import { Input } from "$lib/components/ui/input";
  import { matchesSearch } from "$lib/rent-roll";
  import { Home } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let search = $state("");
  const visible = $derived(data.items.filter((item) => matchesSearch(item, search)));
</script>

<svelte:head><title>Properties · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Properties</h1>
      <p class="text-sm text-muted-foreground">
        Your rent roll — tenancies, rent, arrears and inspection indicators.
      </p>
    </div>
    <span class="text-sm text-muted-foreground">{visible.length} of {data.items.length}</span>
  </div>

  <Input
    type="search"
    placeholder="Search address, suburb, owner or tenant…"
    bind:value={search}
    aria-label="Search properties"
  />

  {#if visible.length === 0}
    <div
      class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center"
    >
      <Home class="h-8 w-8 text-muted-foreground" />
      {#if data.items.length === 0}
        <p class="font-medium">No properties yet</p>
        <p class="max-w-sm text-sm text-muted-foreground">
          Properties appear here once your rent roll is imported during onboarding.
        </p>
      {:else}
        <p class="font-medium">No properties match your search</p>
      {/if}
    </div>
  {:else}
    <div class="space-y-2">
      {#each visible as item (item.id)}
        <PropertyRow {item} today={data.today} />
      {/each}
    </div>
  {/if}
</div>
