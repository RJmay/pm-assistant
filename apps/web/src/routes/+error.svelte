<script lang="ts">
  import { page } from "$app/state";
  import BrandMark from "$lib/components/BrandMark.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Compass, Lock, TriangleAlert } from "lucide-svelte";

  const message = $derived(page.error?.message ?? "Something went wrong");
  // Status-specific icon + copy so errors read as designed, not a fallback.
  const meta = $derived(
    page.status === 404
      ? { icon: Compass, label: "Page not found" }
      : page.status === 403
        ? { icon: Lock, label: "You don't have access to that" }
        : { icon: TriangleAlert, label: "Something went wrong" },
  );
  const Icon = $derived(meta.icon);
</script>

<svelte:head><title>{page.status} · PM Assistant</title></svelte:head>

<div class="flex flex-col items-center justify-center gap-4 py-20 text-center">
  <BrandMark size="md" class="opacity-70" />
  <div class="relative flex flex-col items-center">
    <span class="text-6xl font-bold tracking-tight text-muted-foreground/25">{page.status}</span>
    <span
      class="-mt-3 flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
    >
      <Icon class="h-5 w-5" />
    </span>
  </div>
  <div class="space-y-1">
    <p class="text-lg font-semibold tracking-tight">{meta.label}</p>
    <p class="mx-auto max-w-sm text-sm text-muted-foreground">{message}</p>
  </div>
  <div class="mt-1 flex items-center gap-2">
    <Button href="/queue">Back to the queue</Button>
    {#if page.status >= 500}
      <Button variant="outline" onclick={() => location.reload()}>Try again</Button>
    {/if}
  </div>
  {#if page.status >= 500}
    <p class="text-xs text-muted-foreground">If this keeps happening, contact your administrator.</p>
  {/if}
</div>
