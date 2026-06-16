<script lang="ts" module>
  import { type VariantProps, tv } from "tailwind-variants";

  export const badgeVariants = tv({
    base: "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
    variants: {
      variant: {
        // Soft, tinted badges read calmer than solid fills; only the loud
        // signals (emergency, do-not-send, escalations) get a saturated fill.
        default:
          "border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
        secondary:
          "border-transparent bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
        destructive:
          "border-transparent bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
        outline: "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]",
        brand: "border-transparent bg-[hsl(var(--brand)/0.12)] text-[hsl(var(--brand))]",
        success: "border-transparent bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]",
        warning: "border-transparent bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]",
      },
    },
    defaultVariants: { variant: "default" },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    variant = "default",
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLSpanElement> & {
    variant?: BadgeVariant;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...rest}>
  {@render children?.()}
</span>
