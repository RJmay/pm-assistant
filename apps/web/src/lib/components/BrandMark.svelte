<script lang="ts">
  import { cn } from "$lib/utils";
  import { MailCheck } from "lucide-svelte";

  // The product glyph: a teal rounded square with a white envelope-check mark
  // (email, reviewed + approved). Optionally renders the "PM Assistant"
  // wordmark beside it. Sizes: sm (nav) | md | lg (login).
  let {
    size = "sm",
    wordmark = false,
    class: className,
  }: { size?: "sm" | "md" | "lg"; wordmark?: boolean; class?: string } = $props();

  const box = $derived({ sm: "h-7 w-7", md: "h-9 w-9", lg: "h-11 w-11" }[size]);
  const icon = $derived({ sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" }[size]);
  const word = $derived({ sm: "text-base", md: "text-lg", lg: "text-xl" }[size]);
</script>

<span class={cn("inline-flex items-center gap-2", className)}>
  <span
    class={cn(
      "inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm",
      box,
    )}
  >
    <MailCheck class={icon} />
  </span>
  {#if wordmark}
    <span class={cn("font-semibold tracking-tight", word)}>PM Assistant</span>
  {/if}
</span>
