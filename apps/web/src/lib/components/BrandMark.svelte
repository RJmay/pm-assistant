<script lang="ts">
  import { cn } from "$lib/utils";
  import { MailCheck } from "lucide-svelte";

  // Product glyph: a blue-accent rounded square with a white envelope-check
  // (email, reviewed + approved). The accent fill reads well on both the dark
  // navy sidebar and light pages; the wordmark inherits currentColor so it sits
  // white on the sidebar and ink on auth pages. Sizes: sm (nav) | md | lg.
  let {
    size = "sm",
    wordmark = false,
    class: className,
  }: { size?: "sm" | "md" | "lg"; wordmark?: boolean; class?: string } = $props();

  const box = $derived({ sm: "h-7 w-7", md: "h-9 w-9", lg: "h-12 w-12" }[size]);
  const icon = $derived({ sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" }[size]);
  const word = $derived({ sm: "text-[15px]", md: "text-lg", lg: "text-2xl" }[size]);
</script>

<span class={cn("inline-flex items-center gap-2.5", className)}>
  <span
    class={cn(
      "inline-flex items-center justify-center rounded-[0.6rem] text-white shadow-sm ring-1 ring-inset ring-white/15",
      "bg-[linear-gradient(145deg,hsl(214_92%_56%),hsl(221_83%_45%))]",
      box,
    )}
  >
    <MailCheck class={icon} />
  </span>
  {#if wordmark}
    <span class={cn("font-semibold tracking-tight", word)}>PM Assistant</span>
  {/if}
</span>
