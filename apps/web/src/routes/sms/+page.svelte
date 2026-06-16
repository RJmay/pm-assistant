<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Textarea } from "$lib/components/ui/textarea";
  import { toast } from "$lib/components/ui/sonner";
  import { escalationLabel, relativeTime } from "$lib/format";
  import { env } from "$lib/public-env";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { MessageSquare, ShieldAlert } from "lucide-svelte";
  import type { PageData } from "./$types";

  /** Title-case an SMS intent enum (status_query → Status query). */
  function intentLabel(intent: string): string {
    const s = intent.replaceAll("_", " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  let { data }: { data: PageData } = $props();

  let replies = $state<Record<string, string>>({});
  let busy = $state<string | null>(null);

  // Seed editable replies from the drafted text (once per draft id).
  $effect(() => {
    for (const m of data.messages) {
      if (m.draft_reply != null && !(m.id in replies)) replies[m.id] = m.draft_reply;
    }
  });

  function sender(m: { tenant_name: string | null; from_number: string }): string {
    return m.tenant_name ?? m.from_number;
  }

  async function send(id: string) {
    const text = (replies[id] ?? "").trim();
    if (!text) {
      toast.error("Write a reply first.");
      return;
    }
    const workerUrl = env.PUBLIC_WORKER_URL;
    if (!workerUrl) {
      toast.error("PUBLIC_WORKER_URL is not configured.");
      return;
    }
    busy = id;
    try {
      const supabase = getBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${workerUrl}/api/sms/${id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        toast.success("Reply sent.");
        await invalidateAll();
      } else {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(detail?.error ? detail.error : `Failed (${res.status}).`);
      }
    } catch {
      toast.error("Could not reach the Worker.");
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head><title>SMS · PM Assistant</title></svelte:head>

<div class="space-y-6">
  <PageHeader
    title="SMS"
    description="Inbound texts, classified with a drafted reply for you to review and send. Nothing is sent automatically."
  >
    {#snippet actions()}
      <span
        class="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--muted-foreground))]"
      >
        {data.messages.length} to review
      </span>
    {/snippet}
  </PageHeader>

  {#if data.messages.length === 0}
    <EmptyState
      icon={MessageSquare}
      title="No texts to review"
      description="Inbound tenant SMS will appear here, classified with a drafted reply for you to send."
    />
  {:else}
    <div class="space-y-3">
      {#each data.messages as m (m.id)}
        <Card>
          <CardContent class="space-y-4 pt-6">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-[hsl(var(--foreground))]">{sender(m)}</span>
              {#if m.intent}<Badge variant="outline">{intentLabel(m.intent)}</Badge>{/if}
              {#if m.escalation_flag !== "NONE"}
                <Badge variant="destructive">
                  <ShieldAlert class="mr-1 h-3.5 w-3.5" />{escalationLabel(m.escalation_flag)}
                </Badge>
              {/if}
              <span class="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
                {relativeTime(m.created_at)}
              </span>
            </div>

            <p
              class="whitespace-pre-wrap rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] p-3 text-sm leading-relaxed"
            >
              {m.body}
            </p>

            {#if m.status === "escalated"}
              <p
                class="flex items-start gap-2 rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-sm text-[hsl(var(--destructive))]"
              >
                <ShieldAlert class="mt-0.5 h-4 w-4 shrink-0" />
                <span>Flagged for your attention — handle this personally. No reply was drafted.</span>
              </p>
            {:else}
              <div class="space-y-2">
                <p
                  class="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
                >
                  Drafted reply
                </p>
                <Textarea bind:value={replies[m.id]} class="min-h-[80px]" />
                <Button disabled={busy === m.id} onclick={() => send(m.id)}>
                  {busy === m.id ? "Sending…" : "Send reply"}
                </Button>
              </div>
            {/if}
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}
</div>
