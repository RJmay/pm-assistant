<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Dialog } from "$lib/components/ui/dialog";
  import { toast } from "$lib/components/ui/sonner";
  import { resolveComplianceChips } from "$lib/compliance";
  import { env } from "$lib/public-env";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { CheckCircle2, FlaskConical, Loader2, RefreshCw, Sparkles, X } from "lucide-svelte";
  import type { DemoScenarioListItem } from "../../routes/+layout.server";

  let { scenarios }: { scenarios: DemoScenarioListItem[] } = $props();

  let open = $state(false);
  let injecting = $state<string | null>(null);
  let resetting = $state(false);
  let resetOpen = $state(false);

  const today = new Date().toISOString().slice(0, 10);
  const unused = $derived(scenarios.filter((s) => s.used_at === null));

  async function workerPost(path: string, body: unknown): Promise<Response> {
    const supabase = getBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return fetch(`${env.PUBLIC_WORKER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
  }

  async function inject(scenario: DemoScenarioListItem) {
    if (injecting) return;
    injecting = scenario.key;
    try {
      const res = await workerPost("/api/demo/inject", { scenarioKey: scenario.key });
      const json = (await res.json().catch(() => ({}))) as {
        draftId?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? "Injection failed.");
        return;
      }
      await invalidateAll();
      toast.success(`"${scenario.title}" drafted — opening it…`);
      if (json.draftId) await goto(`/queue/${json.draftId}`);
    } catch {
      toast.error("Could not reach the worker.");
    } finally {
      injecting = null;
    }
  }

  function surpriseMe() {
    const pool = unused.length > 0 ? unused : scenarios;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) void inject(pick);
  }

  async function resetDemo() {
    resetting = true;
    try {
      const res = await workerPost("/api/demo/reset", {});
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(json.error ?? "Reset failed.");
        return;
      }
      resetOpen = false;
      await invalidateAll();
      toast.success("Demo reset — pristine again.");
      await goto("/queue");
    } catch {
      toast.error("Could not reach the worker.");
    } finally {
      resetting = false;
    }
  }
</script>

<!-- Floating demo control — demo tenants only (mounted from the layout). -->
<div class="fixed bottom-16 right-3 z-40 sm:bottom-4 sm:right-4">
  {#if !open}
    <Button onclick={() => (open = true)} class="shadow-lg">
      <FlaskConical class="mr-1.5 h-4 w-4" /> Demo scenarios
    </Button>
  {:else}
    <div
      class="flex max-h-[70vh] w-[min(94vw,380px)] flex-col rounded-lg border bg-background shadow-xl"
    >
      <div class="flex items-center justify-between border-b px-3 py-2">
        <p class="flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical class="h-4 w-4" /> Demo scenarios
        </p>
        <div class="flex items-center gap-1">
          <Button variant="outline" size="sm" onclick={surpriseMe} disabled={injecting !== null}>
            <Sparkles class="mr-1 h-3.5 w-3.5" /> Surprise me
          </Button>
          <button
            type="button"
            class="rounded-sm p-1 opacity-70 hover:opacity-100"
            aria-label="Close demo panel"
            onclick={() => (open = false)}
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div class="flex-1 space-y-2 overflow-y-auto p-3">
        {#each scenarios as s (s.id)}
          {@const chips = resolveComplianceChips(s.compliance, today)}
          <div class="rounded-md border p-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-sm font-medium">
                  {s.title}
                  {#if s.used_at}
                    <CheckCircle2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {/if}
                </p>
                {#if s.description}
                  <p class="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                {/if}
              </div>
              <Button
                size="sm"
                class="shrink-0"
                disabled={injecting !== null}
                onclick={() => inject(s)}
              >
                {#if injecting === s.key}
                  <Loader2 class="mr-1 h-3.5 w-3.5 animate-spin" /> Drafting…
                {:else}
                  Inject
                {/if}
              </Button>
            </div>
            {#if chips.length > 0}
              <div class="mt-1.5 flex flex-wrap gap-1">
                {#each chips as chip (chip.label)}
                  <Badge variant="outline" class="text-[10px]" title={chip.detail ?? undefined}>
                    {chip.label}{chip.detail ? ` — ${chip.detail}` : ""}
                  </Badge>
                {/each}
              </div>
            {/if}
            {#if s.used_at && s.last_draft_id}
              <a
                href={`/queue/${s.last_draft_id}`}
                class="mt-1 inline-block text-xs text-primary hover:underline"
              >
                View the draft →
              </a>
            {/if}
          </div>
        {/each}
      </div>

      <div class="border-t p-2">
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          disabled={resetting}
          onclick={() => (resetOpen = true)}
        >
          <RefreshCw class="mr-1.5 h-3.5 w-3.5" /> Reset demo
        </Button>
      </div>
    </div>
  {/if}
</div>

<Dialog
  bind:open={resetOpen}
  title="Reset the demo?"
  description="Clears every injected email, draft, job and document on this demo tenant and restores all scenarios. Takes a few seconds."
>
  <div class="flex justify-end gap-2">
    <Button type="button" variant="outline" onclick={() => (resetOpen = false)}>Cancel</Button>
    <Button type="button" variant="destructive" disabled={resetting} onclick={resetDemo}>
      {#if resetting}<Loader2 class="mr-1 h-3.5 w-3.5 animate-spin" />{/if}
      Reset demo
    </Button>
  </div>
</Dialog>
