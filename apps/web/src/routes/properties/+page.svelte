<script lang="ts">
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
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

<div class="space-y-6">
  <PageHeader
    title="Properties"
    description="Your rent roll — tenancies, rent, arrears and inspection indicators."
  >
    {#snippet actions()}
      <span
        class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--muted-foreground))]"
      >
        {search ? `${visible.length} of ${data.items.length}` : `${data.items.length} properties`}
      </span>
    {/snippet}
  </PageHeader>

  <Input
    type="search"
    placeholder="Search address, suburb, owner or tenant…"
    bind:value={search}
    aria-label="Search properties"
  />

  {#if visible.length === 0}
    {#if data.items.length === 0}
      <EmptyState
        icon={Home}
        title="No properties yet"
        description="Properties appear here once your rent roll is imported during onboarding."
      />
    {:else}
      <EmptyState
        icon={Home}
        title="No properties match your search"
        description="Try a different address, suburb, owner or tenant name."
      />
    {/if}
  {:else}
    <div class="space-y-2">
      {#each visible as item (item.id)}
        <PropertyRow {item} today={data.today} />
      {/each}
    </div>
  {/if}
</div>
