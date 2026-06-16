<script lang="ts">
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { relativeTime } from "$lib/format";
  import { ArrowLeft, Download, Printer } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let frame = $state<HTMLIFrameElement | null>(null);

  function print() {
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }
</script>

<svelte:head><title>{data.document.title} · PM Assistant</title></svelte:head>

<div class="space-y-6">
  <a
    href="/documents"
    class="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
  >
    <ArrowLeft class="h-4 w-4" /> Back to documents
  </a>

  <PageHeader title={data.document.title}>
    {#snippet actions()}
      {#if data.document.hasPdf}
        <Button variant="outline" href={`/documents/${data.document.id}/pdf`}>
          <Download class="mr-1.5 h-4 w-4" /> Download PDF
        </Button>
      {/if}
      <Button variant="outline" onclick={print}>
        <Printer class="mr-1.5 h-4 w-4" /> Print / Save as PDF
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex flex-wrap items-center gap-2">
    {#if data.document.form_id}<Badge variant="outline">Form {data.document.form_id}</Badge>{/if}
    <span class="text-xs text-[hsl(var(--muted-foreground))]">
      Generated {relativeTime(data.document.created_at)}
    </span>
  </div>

  <!-- The stored content is a complete HTML document; isolate it in a sandboxed iframe. -->
  <iframe
    bind:this={frame}
    title={data.document.title}
    srcdoc={data.document.content}
    sandbox="allow-same-origin allow-modals"
    class="h-[80vh] w-full rounded-xl border border-[hsl(var(--border))] bg-white shadow-sm"
  ></iframe>

  {#if data.document.rule_versions.length > 0}
    <p class="text-xs text-[hsl(var(--muted-foreground))]">
      Compliance rule versions: {data.document.rule_versions.join(", ")}
    </p>
  {/if}
</div>
