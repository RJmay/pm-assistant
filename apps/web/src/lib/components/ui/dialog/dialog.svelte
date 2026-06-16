<script lang="ts">
  import type { Snippet } from "svelte";
  import { X } from "lucide-svelte";
  import { fade, scale } from "svelte/transition";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    title,
    description,
    class: className,
    children,
    footer,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    class?: string;
    children?: Snippet;
    footer?: Snippet;
  } = $props();

  function close() {
    open = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-[hsl(222_47%_8%/0.55)] backdrop-blur-sm"
    role="presentation"
    onclick={close}
    transition:fade={{ duration: 150 }}
  ></div>
  <!-- Panel -->
  <div
    class={cn(
      "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl",
      className,
    )}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    transition:scale={{ duration: 150, start: 0.96 }}
  >
    <div class="flex flex-col space-y-1.5 text-left">
      <h2 class="text-lg font-semibold leading-none tracking-tight">{title}</h2>
      {#if description}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
      {/if}
    </div>

    <div class="py-4">
      {@render children?.()}
    </div>

    {#if footer}
      <div class="flex justify-end gap-2">
        {@render footer()}
      </div>
    {/if}

    <button
      type="button"
      class="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100"
      aria-label="Close"
      onclick={close}
    >
      <X class="h-4 w-4" />
    </button>
  </div>
{/if}
