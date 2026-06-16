<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Dialog } from "$lib/components/ui/dialog";
  import { toast } from "$lib/components/ui/sonner";
  import { relativeTime } from "$lib/format";
  import { diffStats, lineDiff } from "$lib/prompt-diff";
  import { ArrowLeft } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally
  let selectedId = $state(data.active?.id ?? data.versions[0]?.id ?? null);
  let activateTarget = $state<{ id: string; version: string } | null>(null);
  // Bound to the Dialog so closes via Escape/X/backdrop stay in sync (a
  // one-way `open={...}` expression desyncs and the dialog can't reopen).
  let activateOpen = $state(false);

  const selected = $derived(data.versions.find((v) => v.id === selectedId) ?? null);
  const diff = $derived(
    selected && data.active ? lineDiff(data.active.content, selected.content) : [],
  );
  const stats = $derived(diffStats(diff));
</script>

<svelte:head><title>Prompt versions · PM Assistant</title></svelte:head>

<div class="space-y-6">
  <a
    href="/settings"
    class="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
  >
    <ArrowLeft class="h-4 w-4" /> Back to settings
  </a>

  <PageHeader
    title="Prompt versions"
    description="The drafting prompt is versioned and append-only. Activating a version closes the current one and records a new active row — nothing is edited in place."
  >
    {#snippet actions()}
      {#if data.active}
        <span
          class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]"
        >
          Active: {data.active.version} · since {relativeTime(data.active.active_from)}
        </span>
      {:else}
        <span
          class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]"
        >
          No active version
        </span>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="grid gap-4 lg:grid-cols-[320px_1fr]">
    <!-- Version list -->
    <Card>
      <CardHeader><CardTitle class="text-base">Versions</CardTitle></CardHeader>
      <CardContent class="space-y-2">
        {#each data.versions as v (v.id)}
          <div
            class="rounded-xl border p-3 text-sm shadow-sm transition-colors {v.id === selectedId
              ? 'border-[hsl(var(--brand)/0.5)] bg-[hsl(var(--brand)/0.04)]'
              : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--brand)/0.3)]'}"
          >
            <div class="flex items-center justify-between gap-2">
              <button
                type="button"
                class="font-semibold text-[hsl(var(--foreground))] hover:text-[hsl(var(--brand))] hover:underline"
                onclick={() => (selectedId = v.id)}
              >
                {v.version}
              </button>
              <div class="flex items-center gap-1.5">
                {#if v.active_to === null}<Badge variant="success">Active</Badge>{/if}
                {#if v.agency_id === null}<Badge variant="outline">Global</Badge>{/if}
              </div>
            </div>
            <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              {relativeTime(v.active_from)}{v.notes ? ` · ${v.notes}` : ""}
            </p>
            {#if v.active_to !== null}
              <Button
                variant="outline"
                size="sm"
                class="mt-2 h-7 px-2 text-xs"
                onclick={() => {
                  activateTarget = { id: v.id, version: v.version };
                  activateOpen = true;
                }}
              >
                Activate
              </Button>
            {/if}
          </div>
        {:else}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">No versions found.</p>
        {/each}
      </CardContent>
    </Card>

    <!-- Selected version: diff vs active + content -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">
          {selected ? selected.version : "Select a version"}
          {#if selected && data.active && selected.id !== data.active.id}
            <span class="ml-2 text-xs font-normal text-[hsl(var(--muted-foreground))]">
              vs active · <span class="text-[hsl(var(--success))]">+{stats.added}</span>
              <span class="text-[hsl(var(--destructive))]">-{stats.removed}</span>
            </span>
          {/if}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {#if !selected}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">Pick a version from the list.</p>
        {:else if data.active && selected.id !== data.active.id}
          <div class="max-h-[60vh] overflow-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-3 font-mono text-xs leading-relaxed">
            {#each diff as line, i (i)}
              <div
                class={line.type === "add"
                  ? "whitespace-pre-wrap bg-[hsl(var(--success)/0.12)]"
                  : line.type === "del"
                    ? "whitespace-pre-wrap bg-[hsl(var(--destructive)/0.12)]"
                    : "whitespace-pre-wrap"}
              >{line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}{line.text}</div>
            {/each}
          </div>
        {:else}
          <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-3 font-mono text-xs leading-relaxed">{selected.content}</pre>
        {/if}
      </CardContent>
    </Card>
  </div>
</div>

<Dialog
  bind:open={activateOpen}
  title="Activate this prompt version?"
  description="This closes the current active version and records a new active row. The change is audit-logged."
>
  {#if activateTarget}
    <form
      method="POST"
      action="?/activate"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === "success") {
            toast.success("Prompt version activated.");
            activateTarget = null;
            activateOpen = false;
            await invalidateAll();
          } else if (result.type === "failure") {
            toast.error((result.data as { error?: string })?.error ?? "Activation failed.");
          }
        };
      }}
    >
      <input type="hidden" name="versionId" value={activateTarget.id} />
      <p class="text-sm">
        Make <span class="font-medium">{activateTarget.version}</span> the active drafting prompt?
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (activateOpen = false)}>Cancel</Button>
        <Button type="submit">Activate</Button>
      </div>
    </form>
  {/if}
</Dialog>
