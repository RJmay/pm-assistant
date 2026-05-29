<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { class?: string; children?: Snippet } = $props();
</script>

<div
  class={cn(
    "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-sm",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
