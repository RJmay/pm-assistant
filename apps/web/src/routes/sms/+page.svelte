<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Textarea } from "$lib/components/ui/textarea";
  import { toast } from "$lib/components/ui/sonner";
  import { escalationLabel, relativeTime } from "$lib/format";
  import { env } from "$lib/public-env";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { ShieldAlert } from "lucide-svelte";
  import type { PageData } from "./$types";

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

<div class="space-y-4">
  <div>
    <h1 class="text-xl font-semibold">SMS</h1>
    <p class="text-sm text-muted-foreground">
      Inbound texts, classified with a drafted reply for you to review and send. Nothing is sent
      automatically.
    </p>
  </div>

  {#if data.messages.length === 0}
    <p class="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No SMS to review.</p>
  {:else}
    {#each data.messages as m (m.id)}
      <Card>
        <CardContent class="space-y-3 pt-6">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{sender(m)}</span>
            {#if m.intent}<Badge variant="outline">{m.intent.replace("_", " ")}</Badge>{/if}
            {#if m.escalation_flag !== "NONE"}
              <Badge variant="destructive">
                <ShieldAlert class="mr-1 h-3.5 w-3.5" />{escalationLabel(m.escalation_flag)}
              </Badge>
            {/if}
            <span class="ml-auto text-xs text-muted-foreground">{relativeTime(m.created_at)}</span>
          </div>

          <p class="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{m.body}</p>

          {#if m.status === "escalated"}
            <p class="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
              Flagged for your attention — handle this personally. No reply was drafted.
            </p>
          {:else}
            <div class="space-y-1.5">
              <p class="text-xs font-semibold uppercase text-muted-foreground">Drafted reply</p>
              <Textarea bind:value={replies[m.id]} class="min-h-[80px]" />
              <Button disabled={busy === m.id} onclick={() => send(m.id)}>
                {busy === m.id ? "Sending…" : "Send reply"}
              </Button>
            </div>
          {/if}
        </CardContent>
      </Card>
    {/each}
  {/if}
</div>

<style></style>
