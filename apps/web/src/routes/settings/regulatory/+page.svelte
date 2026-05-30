<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { env } from "$env/dynamic/public";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { toast } from "$lib/components/ui/sonner";
  import { relativeTime } from "$lib/format";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { ArrowLeft } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let busyId = $state<string | null>(null);

  function stateVariant(s: string): "default" | "secondary" | "outline" {
    if (s === "approved") return "default";
    if (s === "dismissed") return "outline";
    return "secondary"; // open
  }

  async function review(id: string, action: "approve" | "dismiss") {
    const workerUrl = env.PUBLIC_WORKER_URL;
    if (!workerUrl) {
      toast.error("PUBLIC_WORKER_URL is not configured.");
      return;
    }
    busyId = id;
    try {
      const supabase = getBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${workerUrl}/api/regulatory-alerts/${id}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        toast.success(action === "approve" ? "Alert approved." : "Alert dismissed.");
        await invalidateAll();
      } else {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(detail?.error ? `Failed: ${detail.error}` : `Failed (${res.status}).`);
      }
    } catch {
      toast.error("Could not reach the Worker.");
    } finally {
      busyId = null;
    }
  }
</script>

<svelte:head><title>Regulatory alerts · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <a href="/settings" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft class="h-4 w-4" /> Back to settings
  </a>

  <div>
    <h1 class="text-xl font-semibold">Regulatory alerts</h1>
    <p class="text-sm text-muted-foreground">
      Detected QLD regulatory-source changes for review. Approving records your sign-off; applying a
      change to the rules engine is still a deliberate, versioned step.
    </p>
  </div>

  {#if data.alerts.length === 0}
    <div class="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
      No regulatory alerts yet. The monitoring scan raises one here when a source changes.
    </div>
  {:else}
    {#each data.alerts as alert (alert.id)}
      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <CardTitle class="text-base">
              <a href={alert.source_url} target="_blank" rel="noreferrer" class="hover:underline">
                {alert.source}
              </a>
            </CardTitle>
            <div class="flex items-center gap-2">
              <Badge variant={stateVariant(alert.operator_review_state)}>
                {alert.operator_review_state}
              </Badge>
              <span class="text-xs text-muted-foreground">{relativeTime(alert.detected_at)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <p>{alert.change_summary ?? "(no summary)"}</p>

          <div class="flex flex-wrap items-center gap-2">
            {#if alert.effective_date}
              <Badge variant="outline">Effective {alert.effective_date}</Badge>
            {/if}
            {#each alert.affected_modules as m (m)}
              <Badge variant="secondary">{m}</Badge>
            {/each}
          </div>

          {#if alert.proposed_changes.length > 0}
            <div class="rounded-md border bg-muted/40 p-3">
              <p class="mb-1 text-xs font-semibold uppercase text-muted-foreground">Proposed changes</p>
              <ul class="list-inside list-disc space-y-1">
                {#each alert.proposed_changes as p, i (i)}
                  <li><span class="font-medium">{p.module}</span> — {p.description}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if alert.operator_review_state === "open"}
            <div class="flex gap-2">
              <Button onclick={() => review(alert.id, "approve")} disabled={busyId === alert.id}>
                Approve
              </Button>
              <Button
                variant="outline"
                onclick={() => review(alert.id, "dismiss")}
                disabled={busyId === alert.id}
              >
                Dismiss
              </Button>
            </div>
          {/if}
        </CardContent>
      </Card>
    {/each}
  {/if}
</div>
