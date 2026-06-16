<script lang="ts">
  import type { Snippet } from "svelte";

  // Consistent page top: optional eyebrow, title, description, and right-aligned
  // actions. Used across every dashboard route so headers line up exactly.
  let {
    title,
    description,
    eyebrow,
    actions,
  }: {
    title: string;
    description?: string;
    eyebrow?: string;
    actions?: Snippet;
  } = $props();
</script>

<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div class="space-y-1">
    {#if eyebrow}
      <p class="text-xs font-semibold uppercase tracking-[0.1em] text-[hsl(var(--brand))]">
        {eyebrow}
      </p>
    {/if}
    <h1 class="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">{title}</h1>
    {#if description}
      <p class="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
