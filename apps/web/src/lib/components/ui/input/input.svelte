<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    class: className,
    value = $bindable(),
    ...rest
  }: HTMLInputAttributes & { class?: string } = $props();
</script>

<input
  bind:value
  class={cn(
    "flex h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2 text-sm shadow-sm transition-colors ring-offset-[hsl(var(--background))] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--brand)/0.4)] focus-visible:border-[hsl(var(--brand))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.35)] disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {...rest}
/>
