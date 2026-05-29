<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    class: className,
    value = $bindable(),
    ...rest
  }: HTMLTextareaAttributes & { class?: string } = $props();
</script>

<textarea
  bind:value
  class={cn(
    "flex min-h-[80px] w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm ring-offset-[hsl(var(--background))] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {...rest}
></textarea>
