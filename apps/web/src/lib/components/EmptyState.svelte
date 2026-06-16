<script lang="ts">
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";
  import type { Icon as IconType } from "lucide-svelte";

  // Shared empty-state so every list screen reads the same (was inconsistent —
  // queue/alerts were polished, maintenance/sms/documents were a flat line).
  let {
    icon,
    title,
    description,
    class: className,
    action,
  }: {
    icon: typeof IconType;
    title: string;
    description?: string;
    class?: string;
    action?: Snippet;
  } = $props();

  const Icon = $derived(icon);
</script>

<div
  class={cn(
    "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.6)] px-6 py-16 text-center",
    className,
  )}
>
  <span
    class="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--brand)/0.1)] text-[hsl(var(--brand))] ring-1 ring-inset ring-[hsl(var(--brand)/0.15)]"
  >
    <Icon class="h-6 w-6" />
  </span>
  <div class="space-y-1">
    <p class="font-semibold">{title}</p>
    {#if description}
      <p class="mx-auto max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
    {/if}
  </div>
  {#if action}
    <div class="pt-1">{@render action()}</div>
  {/if}
</div>
