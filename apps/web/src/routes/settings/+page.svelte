<script lang="ts">
  import { enhance } from "$app/forms";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { toast } from "$lib/components/ui/sonner";
  import type { Tradie, VoiceSample } from "$lib/types";
  import { Plus, Trash2 } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally
  let tradies = $state<Tradie[]>(data.tradies.map((t) => ({ ...t })));
  // svelte-ignore state_referenced_locally
  let voice = $state<VoiceSample[]>(data.voiceSamples.map((v) => ({ ...v })));
  // svelte-ignore state_referenced_locally
  let routineDollars = $state(data.routineThresholdDollars);
  // svelte-ignore state_referenced_locally
  let writtenDollars = $state(data.writtenThresholdDollars);
  // svelte-ignore state_referenced_locally
  let houseRules = $state(data.houseRules);
  let saving = $state(false);

  const tradiesJson = $derived(JSON.stringify(tradies));
  const voiceJson = $derived(JSON.stringify(voice));

  function addTradie() {
    tradies = [...tradies, { trade: "", name: "", business_hours_contact: "", after_hours_contact: "" }];
  }
  function removeTradie(i: number) {
    tradies = tradies.filter((_, idx) => idx !== i);
  }
  function addVoice() {
    voice = [...voice, { label: "", body: "" }];
  }
  function removeVoice(i: number) {
    voice = voice.filter((_, idx) => idx !== i);
  }
</script>

<svelte:head><title>Settings · PM Assistant</title></svelte:head>

<form
  method="POST"
  action="?/save"
  class="space-y-6"
  use:enhance={() => {
    saving = true;
    return async ({ result, update }) => {
      saving = false;
      if (result.type === "success") toast.success("Settings saved.");
      else if (result.type === "failure") {
        toast.error((result.data as { error?: string })?.error ?? "Save failed.");
      }
      await update({ reset: false });
    };
  }}
>
  <input type="hidden" name="approved_tradies" value={tradiesJson} />
  <input type="hidden" name="voice_samples" value={voiceJson} />

  <!-- Read-only users get a genuinely read-only form, not silently-lost edits. -->
  <fieldset disabled={!data.isAdmin} class="m-0 min-w-0 space-y-6 border-0 p-0">
  <PageHeader
    title="Agency settings"
    description="Configuration the drafter uses for this agency — spending authority, tradies, voice and house rules."
  >
    {#snippet actions()}
      {#if data.isAdmin}
        <a
          href="/settings/prompts"
          class="text-sm font-medium text-[hsl(var(--brand))] transition-colors hover:underline"
        >
          Prompt versions
        </a>
        <a
          href="/settings/regulatory"
          class="text-sm font-medium text-[hsl(var(--brand))] transition-colors hover:underline"
        >
          Regulatory alerts
        </a>
      {/if}
      <Button type="submit" disabled={saving || !data.isAdmin}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
    {/snippet}
  </PageHeader>

  {#if !data.isAdmin}
    <p
      class="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]"
    >
      You have read-only access to settings. Ask an agency admin or principal to make changes.
    </p>
  {/if}

  {#if !data.hasNominatedRepairer}
    <p class="rounded-xl bg-[hsl(var(--destructive))] px-4 py-3 text-sm text-[hsl(var(--destructive-foreground))]">
      No nominated repairer is configured. Drafting will fail until one is set (required for the
      s218 emergency-repair pathway). Set it directly in the database for now — this editor lands in
      a later milestone.
    </p>
  {/if}

  <!-- Spending authority -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Spending authority</CardTitle>
      <CardDescription>Thresholds the drafter uses to hedge on owner approval.</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-1.5">
        <Label for="routine">Routine approval threshold (AUD)</Label>
        <Input id="routine" name="routine_dollars" type="number" min="0" step="1" bind:value={routineDollars} />
      </div>
      <div class="space-y-1.5">
        <Label for="written">Written quote threshold (AUD)</Label>
        <Input id="written" name="written_dollars" type="number" min="0" step="1" bind:value={writtenDollars} />
      </div>
    </CardContent>
  </Card>

  <!-- Approved tradies -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Approved tradies</CardTitle>
      <CardDescription>Contacts the drafter may reference for maintenance jobs.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      {#each tradies as tradie, i (i)}
        <div class="grid gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for={`trade-${i}`}>Trade</Label>
            <Input id={`trade-${i}`} bind:value={tradie.trade} placeholder="Plumbing" />
          </div>
          <div class="space-y-1.5">
            <Label for={`name-${i}`}>Business name</Label>
            <Input id={`name-${i}`} bind:value={tradie.name} placeholder="Coast Plumbing Co" />
          </div>
          <div class="space-y-1.5">
            <Label for={`bh-${i}`}>Business hours contact</Label>
            <Input id={`bh-${i}`} bind:value={tradie.business_hours_contact} />
          </div>
          <div class="space-y-1.5">
            <Label for={`ah-${i}`}>After hours contact</Label>
            <Input id={`ah-${i}`} bind:value={tradie.after_hours_contact} />
          </div>
          <div class="sm:col-span-2">
            <Button type="button" variant="ghost" size="sm" onclick={() => removeTradie(i)}>
              <Trash2 class="h-4 w-4" /> Remove
            </Button>
          </div>
        </div>
      {/each}
      <Button type="button" variant="outline" size="sm" onclick={addTradie}>
        <Plus class="h-4 w-4" /> Add tradie
      </Button>
    </CardContent>
  </Card>

  <!-- Voice samples -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Voice samples</CardTitle>
      <CardDescription>Representative replies the drafter matches in tone.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      {#each voice as sample, i (i)}
        <div class="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-4">
          <div class="space-y-1.5">
            <Label for={`vlabel-${i}`}>Label</Label>
            <Input id={`vlabel-${i}`} bind:value={sample.label} placeholder="Warm acknowledgement" />
          </div>
          <div class="space-y-1.5">
            <Label for={`vbody-${i}`}>Sample</Label>
            <Textarea id={`vbody-${i}`} bind:value={sample.body} />
          </div>
          <Button type="button" variant="ghost" size="sm" onclick={() => removeVoice(i)}>
            <Trash2 class="h-4 w-4" /> Remove
          </Button>
        </div>
      {/each}
      <Button type="button" variant="outline" size="sm" onclick={addVoice}>
        <Plus class="h-4 w-4" /> Add sample
      </Button>
    </CardContent>
  </Card>

  <!-- House rules -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">House rules</CardTitle>
      <CardDescription>Agency-specific quirks templated into the prompt.</CardDescription>
    </CardHeader>
    <CardContent>
      <Textarea name="house_rules" bind:value={houseRules} class="min-h-[120px]" />
    </CardContent>
  </Card>

  <!-- Read-only: lean notes + quote exceptions -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Current tuning leans</CardTitle>
      <CardDescription>Set from the weekly digest — read-only here.</CardDescription>
    </CardHeader>
    <CardContent>
      {#if data.leanNotes.length === 0}
        <p class="text-sm text-muted-foreground">No active leans.</p>
      {:else}
        <ul class="list-inside list-disc space-y-1 text-sm">
          {#each data.leanNotes as lean (lean.topic + lean.expires_at)}
            <li><strong>{lean.topic}:</strong> {lean.lean}</li>
          {/each}
        </ul>
      {/if}
      {#if data.quoteExceptions.length > 0}
        <div class="mt-4">
          <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Per-owner quote exceptions
          </p>
          <ul class="list-inside list-disc space-y-1 text-sm">
            {#each data.quoteExceptions as ex (ex.note)}<li>{ex.note}</li>{/each}
          </ul>
        </div>
      {/if}
      <p class="mt-4 text-xs text-muted-foreground">
        Owner notification preferences are edited in the database for now; a UI lands in a later
        milestone.
      </p>
    </CardContent>
  </Card>
  </fieldset>
</form>
