<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { auditFiltersToQuery, hasActiveAuditFilter } from "$lib/audit-filters";
  import { relativeTime } from "$lib/format";
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

<div class="space-y-4">
  <div>
    <h1 class="text-xl font-semibold">Audit log</h1>
    <p class="text-sm text-muted-foreground">
      Every inbound item, draft, edit, send, and system action — append-only.
    </p>
  </div>

  <!-- Filters (URL-driven GET form; resets to page 1) -->
  <form method="GET" class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
    <div class="space-y-1.5">
      <Label for="action">Action contains</Label>
      <Input id="action" name="action" value={data.filter.action ?? ""} placeholder="e.g. draft, gmail" />
    </div>
    <div class="space-y-1.5">
      <Label for="actor">Actor</Label>
      <select
        id="actor"
        name="actor"
        class="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
      <a href="/audit" class="text-sm text-muted-foreground hover:text-foreground">Clear</a>
    {/if}
  </form>

  {#if data.rows.length === 0}
    <div class="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
      No audit entries{hasActiveAuditFilter(data.filter) ? " match these filters" : " yet"}.
    </div>
  {:else}
    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th class="px-3 py-2 font-medium">When</th>
            <th class="px-3 py-2 font-medium">Actor</th>
            <th class="px-3 py-2 font-medium">Action</th>
            <th class="px-3 py-2 font-medium">Entity</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.id)}
            <tr class="border-b last:border-0 align-top">
              <td class="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {relativeTime(row.created_at)}
              </td>
              <td class="px-3 py-2">
                <Badge variant={actorVariant(row.actor_type)}>{row.actor_type}</Badge>
              </td>
              <td class="px-3 py-2 font-mono text-xs">{row.action}</td>
              <td class="px-3 py-2 text-xs text-muted-foreground">
                {row.entity_type ?? ""}{row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between text-sm">
      <span class="text-muted-foreground">
        {data.total} entr{data.total === 1 ? "y" : "ies"} · page {data.filter.page} of {totalPages}
      </span>
      <div class="flex gap-2">
        {#if data.filter.page > 1}
          <a href={prevHref} class="rounded-md border px-3 py-1.5 hover:bg-accent">Previous</a>
        {/if}
        {#if data.filter.page < totalPages}
          <a href={nextHref} class="rounded-md border px-3 py-1.5 hover:bg-accent">Next</a>
        {/if}
      </div>
    </div>
  {/if}
</div>
