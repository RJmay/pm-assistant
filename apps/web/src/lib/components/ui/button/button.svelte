<script lang="ts" module>
  import { type VariantProps, tv } from "tailwind-variants";

  export const buttonVariants = tv({
    base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50",
    variants: {
      variant: {
        default: "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
        destructive:
          "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90",
        outline:
          "border border-[hsl(var(--input))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]",
        secondary:
          "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:opacity-80",
        ghost: "hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]",
        link: "text-[hsl(var(--primary))] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  type Props = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    class?: string;
    href?: string;
    type?: HTMLButtonAttributes["type"];
    disabled?: boolean;
    children?: Snippet;
  } & HTMLButtonAttributes &
    HTMLAnchorAttributes;

  let {
    variant = "default",
    size = "default",
    class: className,
    href,
    type = "button",
    disabled,
    children,
    ...rest
  }: Props = $props();
</script>

{#if href}
  <a {href} class={cn(buttonVariants({ variant, size }), className)} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button {type} {disabled} class={cn(buttonVariants({ variant, size }), className)} {...rest}>
    {@render children?.()}
  </button>
{/if}
