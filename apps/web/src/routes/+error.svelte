<script lang="ts">
  import { page } from "$app/state";
  import { AlertTriangle } from "lucide-svelte";

  const message = $derived(page.error?.message ?? "Something went wrong");
</script>

<svelte:head><title>{page.status} · PM Assistant</title></svelte:head>

<div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-20 text-center">
  <AlertTriangle class="h-8 w-8 text-muted-foreground" />
  <p class="text-3xl font-semibold tracking-tight">{page.status}</p>
  <p class="text-sm text-muted-foreground">{message}</p>
  <a
    href="/queue"
    class="mt-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
  >
    Back to the queue
  </a>
</div>
