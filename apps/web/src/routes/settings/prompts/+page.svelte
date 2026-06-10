<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
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

<div class="space-y-4">
  <a href="/settings" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft class="h-4 w-4" /> Back to settings
  </a>

  <div>
    <h1 class="text-xl font-semibold">Prompt versions</h1>
    <p class="text-sm text-muted-foreground">
      The drafting prompt is versioned and append-only. Activating a version closes the current
      one and records a new active row — nothing is edited in place.
    </p>
  </div>

  {#if data.active}
    <p class="text-sm">
      Active: <span class="font-medium">{data.active.version}</span>
      <span class="text-muted-foreground">· since {relativeTime(data.active.active_from)}</span>
    </p>
  {:else}
    <p class="text-sm text-muted-foreground">No active prompt version for this agency.</p>
  {/if}

  <div class="grid gap-4 lg:grid-cols-[320px_1fr]">
    <!-- Version list -->
    <Card>
      <CardHeader><CardTitle class="text-base">Versions</CardTitle></CardHeader>
      <CardContent class="space-y-2">
        {#each data.versions as v (v.id)}
          <div
            class="rounded-md border p-2.5 text-sm {v.id === selectedId ? 'border-foreground' : ''}"
          >
            <div class="flex items-center justify-between gap-2">
              <button type="button" class="font-medium hover:underline" onclick={() => (selectedId = v.id)}>
                {v.version}
              </button>
              <div class="flex items-center gap-1.5">
                {#if v.active_to === null}<Badge>Active</Badge>{/if}
                {#if v.agency_id === null}<Badge variant="outline">Global</Badge>{/if}
              </div>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {relativeTime(v.active_from)}{v.notes ? ` · ${v.notes}` : ""}
            </p>
            {#if v.active_to !== null}
              <Button
                variant="outline"
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
          <p class="text-sm text-muted-foreground">No versions found.</p>
        {/each}
      </CardContent>
    </Card>

    <!-- Selected version: diff vs active + content -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">
          {selected ? selected.version : "Select a version"}
          {#if selected && data.active && selected.id !== data.active.id}
            <span class="ml-2 text-xs font-normal text-muted-foreground">
              vs active · <span class="text-green-600">+{stats.added}</span>
              <span class="text-red-600">-{stats.removed}</span>
            </span>
          {/if}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {#if !selected}
          <p class="text-sm text-muted-foreground">Pick a version from the list.</p>
        {:else if data.active && selected.id !== data.active.id}
          <div class="max-h-[60vh] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
            {#each diff as line, i (i)}
              <div
                class={line.type === "add"
                  ? "whitespace-pre-wrap bg-green-500/15"
                  : line.type === "del"
                    ? "whitespace-pre-wrap bg-red-500/15"
                    : "whitespace-pre-wrap"}
              >{line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}{line.text}</div>
            {/each}
          </div>
        {:else}
          <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">{selected.content}</pre>
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
