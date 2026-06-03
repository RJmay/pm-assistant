<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { relativeTime } from "$lib/format";
  import { ArrowLeft, Printer } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let frame = $state<HTMLIFrameElement | null>(null);

  function print() {
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }
</script>

<svelte:head><title>{data.document.title} · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <a
      href="/documents"
      class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="h-4 w-4" /> Back to documents
    </a>
    <Button variant="outline" onclick={print}>
      <Printer class="mr-1.5 h-4 w-4" /> Print / Save as PDF
    </Button>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <span class="font-medium">{data.document.title}</span>
    {#if data.document.form_id}<Badge variant="outline">Form {data.document.form_id}</Badge>{/if}
    <span class="text-xs text-muted-foreground">generated {relativeTime(data.document.created_at)}</span>
  </div>

  <!-- The stored content is a complete HTML document; isolate it in a sandboxed iframe. -->
  <iframe
    bind:this={frame}
    title={data.document.title}
    srcdoc={data.document.content}
    sandbox="allow-same-origin allow-modals"
    class="h-[80vh] w-full rounded-lg border bg-white"
  ></iframe>

  {#if data.document.rule_versions.length > 0}
    <p class="text-xs text-muted-foreground">
      Compliance rule versions: {data.document.rule_versions.join(", ")}
    </p>
  {/if}
</div>

<style></style>
