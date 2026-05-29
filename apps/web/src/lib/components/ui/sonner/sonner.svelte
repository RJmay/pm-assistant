<script lang="ts">
  import { Toaster as Sonner } from "svelte-sonner";

  // Thin wrapper so the app mounts a single themed Toaster in the root layout.
  let props = $props();
</script>

<Sonner
  class="toaster"
  toastOptions={{
    classes: {
      toast:
        "rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-lg",
    },
  }}
  {...props}
/>
