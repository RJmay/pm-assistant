<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import DraftRow from "$lib/components/DraftRow.svelte";
  import { categoryLabel, escalationLabel } from "$lib/format";
  import {
    applyFilters,
    filtersToQuery,
    hasActiveFilter,
    parseFilters,
    type QueueFilter,
    type QueueSort,
    sortQueue,
  } from "$lib/queue-filters";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { getBrowserClient } from "$lib/supabase-browser";
  import type { DraftCategory, EscalationFlag } from "$lib/types";
  import { cn } from "$lib/utils";
  import { Inbox, X } from "lucide-svelte";
  import { onMount } from "svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const selectCls =
    "h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.4)]";

  const CATEGORIES: DraftCategory[] = [
    "MAINTENANCE",
    "RENT",
    "LEASE",
    "COMPLAINT",
    "ADMIN",
    "OTHER",
  ];
  const ESCALATIONS: EscalationFlag[] = ["WELFARE", "LEGAL", "REPUTATIONAL", "INCIDENT"];

  // Local source of truth (initialised from the URL for deep-links/refresh).
  // Shallow routing (`replaceState`) updates the address bar but does NOT
  // reactively update `page.url`, so we drive reactivity from $state here and
  // mirror it back to the URL for shareability.
  let filter = $state<QueueFilter>(parseFilters(page.url.searchParams));
  const visible = $derived(sortQueue(applyFilters(data.items, filter), filter.sort));

  function setSort(e: Event) {
    setFilter({ ...filter, sort: (e.currentTarget as HTMLSelectElement).value as QueueSort });
  }

  function setFilter(next: QueueFilter) {
    filter = next;
    replaceState(`/queue${filtersToQuery(next)}`, {});
  }
  function toggleCategory(c: DraftCategory) {
    const has = filter.categories.includes(c);
    setFilter({
      ...filter,
      categories: has ? filter.categories.filter((x) => x !== c) : [...filter.categories, c],
    });
  }
  function toggleEscalation(e: EscalationFlag) {
    const has = filter.escalations.includes(e);
    setFilter({
      ...filter,
      escalations: has ? filter.escalations.filter((x) => x !== e) : [...filter.escalations, e],
    });
  }
  function setPm(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    setFilter({ ...filter, pmId: value || null });
  }
  function clearFilters() {
    setFilter({ categories: [], escalations: [], pmId: null, sort: filter.sort });
  }

  // Realtime: any change to this agency's drafts re-fetches the joined list.
  onMount(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("queue-ai-drafts")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_drafts" }, () => {
        void invalidateAll();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  });
</script>

<svelte:head><title>Queue · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Daily queue</h1>
      <p class="text-sm text-muted-foreground">
        Drafts awaiting review — nothing sends until you approve it.
      </p>
    </div>
    <span class="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {hasActiveFilter(filter) ? `${visible.length} of ${data.items.length}` : `${data.items.length} drafts`}
    </span>
  </div>

  <!-- Filter bar -->
  <div class="space-y-2 rounded-lg border bg-card p-3">
    <div class="flex flex-wrap gap-1.5">
      {#each CATEGORIES as c (c)}
        <button
          type="button"
          onclick={() => toggleCategory(c)}
          aria-pressed={filter.categories.includes(c)}
          class={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
            filter.categories.includes(c)
              ? "border-transparent bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {categoryLabel(c)}
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each ESCALATIONS as e (e)}
        <button
          type="button"
          onclick={() => toggleEscalation(e)}
          aria-pressed={filter.escalations.includes(e)}
          class={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
            filter.escalations.includes(e)
              ? "border-transparent bg-destructive text-destructive-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {escalationLabel(e)}
        </button>
      {/each}
      <div class="ml-auto flex items-center gap-1.5">
        <select onchange={setSort} value={filter.sort} class={selectCls} aria-label="Sort the queue">
          <option value="urgency">Highest urgency</option>
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
        </select>
        {#if data.pms.length > 0}
          <select
            onchange={setPm}
            value={filter.pmId ?? ""}
            class={selectCls}
            aria-label="Filter by property manager"
          >
            <option value="">All PMs</option>
            {#each data.pms as pm (pm.id)}
              <option value={pm.id}>{pm.name}</option>
            {/each}
          </select>
        {/if}
      </div>
    </div>
    {#if hasActiveFilter(filter)}
      <button
        type="button"
        onclick={clearFilters}
        class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X class="h-3 w-3" /> Clear filters
      </button>
    {/if}
  </div>

  <!-- List -->
  {#if visible.length === 0}
    {#if data.items.length === 0}
      <EmptyState
        icon={Inbox}
        title="All caught up"
        description={data.isDemo
          ? "Open the Demo scenarios panel and inject one to watch a draft appear."
          : "New drafts land here as email arrives — nothing sends without your review."}
      />
    {:else}
      <EmptyState icon={Inbox} title="No drafts match your filters">
        {#snippet action()}
          <button
            type="button"
            onclick={clearFilters}
            class="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <X class="h-3.5 w-3.5" /> Clear filters
          </button>
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <div class="space-y-2">
      {#each visible as item (item.id)}
        <DraftRow {item} />
      {/each}
    </div>
  {/if}
</div>
