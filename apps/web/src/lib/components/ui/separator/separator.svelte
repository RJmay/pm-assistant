<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    class: className,
    orientation = "horizontal",
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    class?: string;
    orientation?: "horizontal" | "vertical";
  } = $props();
</script>

<div
  role="separator"
  aria-orientation={orientation}
  class={cn(
    "shrink-0 bg-[hsl(var(--border))]",
    orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
    className,
  )}
  {...rest}
></div>
