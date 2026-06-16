<script lang="ts">
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { auditFiltersToQuery, hasActiveAuditFilter } from "$lib/audit-filters";
  import { relativeTime } from "$lib/format";
  import { ScrollText } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
  const prevHref = $derived(auditFiltersToQuery({ ...data.filter, page: data.filter.page - 1 }) || "?");
  const nextHref = $derived(auditFiltersToQuery({ ...data.filter, page: data.filter.page + 1 }));

  function actorVariant(t: string): "secondary" | "outline" | "default" {
    if (t === "user") return "default";
    if (t === "ai") return "secondary";
    return "outline";
  }
</script>

<svelte:head><title>Audit log · PM Assistant</title></svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Audit log"
    description="Every inbound item, draft, edit, send, and system action — append-only."
  >
    {#snippet actions()}
      <span
        class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--muted-foreground))]"
      >
        {data.total} entr{data.total === 1 ? "y" : "ies"}
      </span>
    {/snippet}
  </PageHeader>

  <!-- Filters (URL-driven GET form; resets to page 1) -->
  <form
    method="GET"
    class="flex flex-wrap items-end gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm"
  >
    <div class="space-y-1.5">
      <Label for="action">Action contains</Label>
      <Input id="action" name="action" value={data.filter.action ?? ""} placeholder="e.g. draft, gmail" />
    </div>
    <div class="space-y-1.5">
      <Label for="actor">Actor</Label>
      <select
        id="actor"
        name="actor"
        class="h-9 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.4)]"
      >
        <option value="" selected={data.filter.actorType === null}>Any</option>
        <option value="user" selected={data.filter.actorType === "user"}>User</option>
        <option value="system" selected={data.filter.actorType === "system"}>System</option>
        <option value="ai" selected={data.filter.actorType === "ai"}>AI</option>
      </select>
    </div>
    <div class="space-y-1.5">
      <Label for="from">From date</Label>
      <Input id="from" name="from" type="date" value={data.filter.from ?? ""} />
    </div>
    <Button type="submit" variant="outline">Filter</Button>
    {#if hasActiveAuditFilter(data.filter)}
      <a
        href="/audit"
        class="text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
      >
        Clear
      </a>
    {/if}
  </form>

  {#if data.rows.length === 0}
    <EmptyState
      icon={ScrollText}
      title={hasActiveAuditFilter(data.filter)
        ? "No audit entries match these filters"
        : "No audit entries yet"}
      description="Inbound items, drafts, edits, sends, and system actions are recorded here as they happen."
    />
  {:else}
    <div class="overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
      <table class="w-full text-sm">
        <thead
          class="border-b border-[hsl(var(--border))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
        >
          <tr>
            <th class="px-4 py-3 font-semibold">When</th>
            <th class="px-4 py-3 font-semibold">Actor</th>
            <th class="px-4 py-3 font-semibold">Action</th>
            <th class="px-4 py-3 font-semibold">Entity</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.id)}
            <tr
              class="border-b border-[hsl(var(--border))] align-top transition-colors last:border-0 hover:bg-[hsl(var(--muted)/0.4)]"
            >
              <td class="whitespace-nowrap px-4 py-3 tabular-nums text-[hsl(var(--muted-foreground))]">
                {relativeTime(row.created_at)}
              </td>
              <td class="px-4 py-3">
                <Badge variant={actorVariant(row.actor_type)}>{row.actor_type}</Badge>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-[hsl(var(--foreground))]">{row.action}</td>
              <td class="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                {row.entity_type ?? ""}{row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between text-sm">
      <span class="tabular-nums text-[hsl(var(--muted-foreground))]">
        {data.total} entr{data.total === 1 ? "y" : "ies"} · page {data.filter.page} of {totalPages}
      </span>
      <div class="flex gap-2">
        {#if data.filter.page > 1}
          <Button href={prevHref} variant="outline" size="sm">Previous</Button>
        {/if}
        {#if data.filter.page < totalPages}
          <Button href={nextHref} variant="outline" size="sm">Next</Button>
        {/if}
      </div>
    </div>
  {/if}
</div>
