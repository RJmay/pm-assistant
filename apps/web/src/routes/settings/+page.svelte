<script lang="ts">
  import { enhance } from "$app/forms";
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

{#if data.isAdmin}
  <div class="mb-4 flex flex-wrap gap-2">
    <a
      href="/settings/prompts"
      class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
    >
      Manage prompt versions →
    </a>
    <a
      href="/settings/regulatory"
      class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
    >
      Regulatory alerts →
    </a>
  </div>
{:else}
  <p class="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
    You have read-only access to settings. Ask an agency admin or principal to make changes.
  </p>
{/if}

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
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-semibold tracking-tight">Agency settings</h1>
    <Button type="submit" disabled={saving || !data.isAdmin}>
      {saving ? "Saving…" : "Save changes"}
    </Button>
  </div>

  {#if !data.hasNominatedRepairer}
    <p class="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
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
        <div class="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
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
        <div class="space-y-2 rounded-md border p-3">
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
          <p class="mb-1 text-xs font-semibold uppercase text-muted-foreground">
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
