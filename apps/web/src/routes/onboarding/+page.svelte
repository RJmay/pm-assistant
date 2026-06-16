<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { toast } from "$lib/components/ui/sonner";
  import { parseCsv } from "$lib/csv";
  import {
    detectMapping,
    detectPreset,
    FIELD_LABELS,
    IMPORT_FIELDS,
    type ImportField,
    type ImportRow,
    type Mapping,
    PRESETS,
    validateRow,
  } from "$lib/import-presets";
  import { env } from "$lib/public-env";
  import BrandMark from "$lib/components/BrandMark.svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { CheckCircle2, Circle, Lock, Mail, ShieldCheck, Sparkles, Upload } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const STEPS = [
    { id: "account", label: "Account" },
    { id: "connect-email", label: "Connect email" },
    { id: "import", label: "Import portfolio" },
    { id: "voice", label: "Voice & guardrails" },
    { id: "first-draft", label: "First draft" },
  ] as const;

  // svelte-ignore state_referenced_locally
  let current = $state<string>(data.step);
  // svelte-ignore state_referenced_locally
  let serverStep = $state<string>(data.step);
  $effect(() => {
    // Only a server-persisted step CHANGE moves the wizard — unrelated form
    // actions (which also invalidate `data`) must not clobber local stepper
    // navigation back to the persisted step.
    if (data.step !== serverStep) {
      serverStep = data.step;
      current = data.step;
    }
  });

  const completed = $derived(new Set(data.completedSteps));
  const hasAgency = $derived(data.agencyName !== null);
  let busy = $state(false);

  function handle(message: string | null = null): SubmitFunction {
    return () => {
      busy = true;
      return async ({ result, update }) => {
        busy = false;
        if (result.type === "failure") {
          toast.error((result.data as { error?: string })?.error ?? "Something went wrong.");
        } else if (result.type === "success" && message) {
          toast.success(message);
        }
        await update({ reset: false });
      };
    };
  }

  // ---- Step 3 (CSV) client state -------------------------------------------
  let csvHeaders = $state<string[]>([]);
  let csvRows = $state<string[][]>([]);
  let mapping = $state<Mapping>({});
  let presetId = $state<string | null>(null);

  const rowResults = $derived(csvRows.map((r) => validateRow(r, mapping)));
  const validRows = $derived(
    rowResults.filter((r): r is { row: ImportRow; errors: string[] } => r.row !== null),
  );
  const errorCount = $derived(rowResults.length - validRows.length);

  async function onCsvChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error("That file looks empty — export your rent roll as CSV and try again.");
      return;
    }
    csvHeaders = parsed.headers;
    csvRows = parsed.rows;
    mapping = detectMapping(parsed.headers);
    presetId = detectPreset(parsed.headers);
  }

  function setMapping(field: ImportField, e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    const next: Mapping = { ...mapping };
    if (value === "") delete next[field];
    else next[field] = Number(value);
    mapping = next;
  }

  function fixCell(rowIdx: number, field: ImportField, e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    const colIdx = mapping[field];
    if (colIdx === undefined) return;
    const next = csvRows.map((r) => [...r]);
    const target = next[rowIdx];
    if (target) target[colIdx] = value;
    csvRows = next;
  }

  const presetLabel = $derived(PRESETS.find((p) => p.id === presetId)?.label ?? null);
  const workerBase = (env.PUBLIC_WORKER_URL ?? "").replace(/\/+$/, "");

  /** Import submit: on success, drop the imported rows from the staging state
   * (keep only still-broken rows) so a re-click can't import twice. */
  const handleImport: SubmitFunction = () => {
    busy = true;
    return async ({ result, update }) => {
      busy = false;
      if (result.type === "failure") {
        toast.error((result.data as { error?: string })?.error ?? "Import failed.");
      } else if (result.type === "success") {
        const d = result.data as { imported?: number; skipped?: number };
        toast.success(
          `Imported ${d.imported ?? 0} propert${(d.imported ?? 0) === 1 ? "y" : "ies"}${
            d.skipped ? ` (${d.skipped} already existed)` : ""
          }.`,
        );
        const stillBroken = csvRows.filter((_, i) => rowResults[i]?.row === null);
        csvRows = stillBroken;
        if (stillBroken.length === 0) {
          csvHeaders = [];
          mapping = {};
          presetId = null;
        }
      }
      await update({ reset: false });
    };
  };

  /** Each validation message maps to exactly one field — the inline-fix
   * inputs cover precisely what the row's errors report (when mapped). */
  const ERROR_FIELD: Record<string, ImportField> = {
    "Street address is required": "address_line1",
    "Owner name is required": "owner_name",
    "Owner email looks invalid": "owner_email",
    "Tenant email looks invalid": "tenant_email",
    "Rent must be a number": "rent_weekly",
    "Lease start must be a date (DD/MM/YYYY)": "lease_start",
    "Lease end must be a date (DD/MM/YYYY)": "lease_end",
    "Bond must be a number": "bond",
  };
  function fixableFields(rowIdx: number): ImportField[] {
    const errors = rowResults[rowIdx]?.errors ?? [];
    const fields = errors
      .map((e) => ERROR_FIELD[e])
      .filter((f): f is ImportField => f !== undefined && mapping[f] !== undefined);
    return [...new Set(fields)];
  }
</script>

<svelte:head><title>Get started · PM Assistant</title></svelte:head>

<div class="bg-auth min-h-screen px-4 py-10">
  <div class="mx-auto max-w-2xl space-y-6">
    <div class="flex justify-center">
      <BrandMark size="md" wordmark />
    </div>

    <div class="space-y-1 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">
        {hasAgency ? `Welcome, ${data.agencyName}` : "Set up your agency"}
      </h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Five quick steps — each one is skippable, and your progress is saved as you go.
      </p>
    </div>

    <!-- Stepper -->
    <ol class="flex flex-wrap justify-center gap-1.5">
      {#each STEPS as step, i (step.id)}
        <li>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors
              {current === step.id
              ? 'border-transparent bg-[hsl(var(--brand))] text-[hsl(var(--brand-foreground))]'
              : completed.has(step.id)
                ? 'border-[hsl(var(--brand)/0.25)] bg-[hsl(var(--brand)/0.1)] text-[hsl(var(--brand))] hover:bg-[hsl(var(--brand)/0.16)]'
                : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'}"
            disabled={!hasAgency && step.id !== "account"}
            onclick={() => (current = step.id)}
          >
            {#if completed.has(step.id)}
              <CheckCircle2 class="h-3.5 w-3.5" />
            {:else}
              <Circle class="h-3 w-3" />
            {/if}
            {i + 1}. {step.label}
          </button>
        </li>
      {/each}
    </ol>

  <!-- Step 1: Account -->
  {#if current === "account"}
    <Card class="rounded-2xl p-2">
      <CardHeader>
        <CardTitle class="text-base">Your agency</CardTitle>
        <CardDescription>
          {hasAgency
            ? "Done — your agency is set up."
            : "This creates your private workspace. Nothing is shared between agencies."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {#if hasAgency}
          <div class="flex items-center justify-between">
            <p class="flex items-center gap-1.5 text-sm">
              <CheckCircle2 class="h-4 w-4 text-[hsl(var(--success))]" />
              {data.agencyName}
            </p>
            <Button size="sm" onclick={() => (current = "connect-email")}>Continue</Button>
          </div>
        {:else}
          <form method="POST" action="?/provision" class="space-y-3" use:enhance={handle()}>
            <div class="space-y-1.5">
              <Label for="agencyName">Agency name</Label>
              <Input id="agencyName" name="agencyName" required placeholder="Acme Property Management" />
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="suburb">Suburb / region</Label>
                <Input id="suburb" name="suburb" placeholder="Maroochydore" />
              </div>
              <div class="space-y-1.5">
                <Label for="fullName">Your name</Label>
                <Input id="fullName" name="fullName" placeholder="Jess Bowman" />
              </div>
            </div>
            <Button type="submit" variant="brand" disabled={busy}>
              {busy ? "Creating…" : "Create my agency"}
            </Button>
          </form>
        {/if}
      </CardContent>
    </Card>
  {/if}

  <!-- Step 2: Connect email -->
  {#if current === "connect-email" && hasAgency}
    <Card class="rounded-2xl p-2">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <Mail class="h-4 w-4" /> Connect your rentals inbox
        </CardTitle>
        <CardDescription>
          PM Assistant reads the inbox you connect and drafts replies into your review queue. It
          never sends anything itself.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        {#if data.mailboxAddress}
          <p class="flex items-start gap-2 rounded-lg border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] px-3 py-2 text-sm text-[hsl(var(--success))]">
            <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0" />
            <span>Connected: <span class="font-medium">{data.mailboxAddress}</span> — inbound email
            now flows into your queue.</span>
          </p>
        {:else}
          <div class="rounded-lg border border-[hsl(var(--border))] p-3">
            <p class="text-sm font-medium">Connect Gmail / Google Workspace</p>
            <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              One click, sign in with the agency mailbox (e.g. rentals@youragency.com.au), done.
            </p>
            <Button
              variant="brand"
              class="mt-2"
              onclick={() =>
                (location.href = `${workerBase}/oauth/gmail/start?agency_id=${data.agencyId}`)}
            >
              Connect Gmail
            </Button>
          </div>
        {/if}
        <div class="rounded-lg border border-dashed border-[hsl(var(--border))] p-3 opacity-70">
          <p class="flex items-center text-sm font-medium">
            Forwarding address
            <Badge variant="outline" class="ml-1">Coming soon</Badge>
          </p>
          <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
            Auto-forward from any mail system (Outlook/Microsoft 365 included) to a dedicated
            ingest address — no account connection at all.
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <form method="POST" action="?/goto" use:enhance={handle()}>
            <input type="hidden" name="step" value="import" />
            <Button type="submit" variant="outline" size="sm">Skip for now</Button>
          </form>
          <form method="POST" action="?/goto" use:enhance={handle()}>
            <input type="hidden" name="step" value="import" />
            <input type="hidden" name="complete" value="connect-email" />
            <Button type="submit" size="sm" disabled={!data.mailboxAddress}>Continue</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  {/if}

  <!-- Step 3: Import portfolio -->
  {#if current === "import" && hasAgency}
    <Card class="rounded-2xl p-2">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <Upload class="h-4 w-4" /> Import your portfolio
        </CardTitle>
        <CardDescription>
          Upload a CSV export from PropertyMe, Console Cloud, VaultRE — or any spreadsheet. We'll
          map the columns; you confirm.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        {#if data.propertyCount > 0}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">
            {data.propertyCount} propert{data.propertyCount === 1 ? "y" : "ies"} already imported.
            You can add more below.
          </p>
        {/if}
        <Input type="file" accept=".csv,text/csv" onchange={onCsvChange} aria-label="Upload CSV" />

        {#if csvHeaders.length > 0}
          {#if presetLabel}
            <p class="text-xs text-[hsl(var(--muted-foreground))]">
              Looks like a <span class="font-medium">{presetLabel}</span> export — columns mapped
              automatically. Adjust below if anything's off.
            </p>
          {/if}
          <div class="grid gap-2 sm:grid-cols-2">
            {#each IMPORT_FIELDS as field (field)}
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="text-[hsl(var(--muted-foreground))]">{FIELD_LABELS[field]}</span>
                <select
                  class="h-8 max-w-[55%] rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
                  value={mapping[field]?.toString() ?? ""}
                  onchange={(e) => setMapping(field, e)}
                  aria-label={`Column for ${FIELD_LABELS[field]}`}
                >
                  <option value="">—</option>
                  {#each csvHeaders as h, i (i)}
                    <option value={i.toString()}>{h}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>

          <div class="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-sm">
            <span class="font-medium">{validRows.length}</span> row{validRows.length === 1
              ? ""
              : "s"} ready to import{errorCount > 0
              ? ` · ${errorCount} need${errorCount === 1 ? "s" : ""} fixing below`
              : ""}.
          </div>

          {#if errorCount > 0}
            <div class="max-h-56 space-y-2 overflow-y-auto">
              {#each rowResults as result, i (i)}
                {#if result.errors.length > 0}
                  <div class="rounded-lg border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] p-2 text-xs">
                    <p class="font-medium">Row {i + 2}: {result.errors.join("; ")}</p>
                    <div class="mt-1 grid gap-1 sm:grid-cols-2">
                      {#each fixableFields(i) as field (field)}
                        <label class="flex items-center gap-1">
                          <span class="w-24 shrink-0 text-[hsl(var(--muted-foreground))]">{FIELD_LABELS[field]}</span>
                          <Input
                            class="h-7 text-xs"
                            value={csvRows[i]?.[mapping[field] ?? -1] ?? ""}
                            oninput={(e) => fixCell(i, field, e)}
                          />
                        </label>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}

          <form method="POST" action="?/importRows" use:enhance={handleImport}>
            <input type="hidden" name="rows" value={JSON.stringify(validRows.map((r) => r.row))} />
            <Button type="submit" variant="brand" disabled={busy || validRows.length === 0}>
              {busy ? "Importing…" : `Import ${validRows.length} propert${validRows.length === 1 ? "y" : "ies"}`}
            </Button>
          </form>
        {/if}

        <div class="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
          <form method="POST" action="?/sampleData" use:enhance={handle("Sample data added.")}>
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              <Sparkles class="mr-1 h-3.5 w-3.5" /> Start with sample data
            </Button>
          </form>
          <form method="POST" action="?/goto" use:enhance={handle()}>
            <input type="hidden" name="step" value="voice" />
            <Button type="submit" variant="outline" size="sm">Skip for now</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  {/if}

  <!-- Step 4: Voice & guardrails -->
  {#if current === "voice" && hasAgency}
    <Card class="rounded-2xl p-2">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <ShieldCheck class="h-4 w-4" /> Voice & guardrails
        </CardTitle>
        <CardDescription>How drafts should sound, and the safety rails they run on.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/saveVoice" class="space-y-3" use:enhance={handle("Saved.")}>
          <div
            class="flex items-start gap-2 rounded-lg border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] px-3 py-2"
          >
            <Lock class="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
            <p class="text-sm text-[hsl(var(--foreground))]">
              <span class="font-semibold">Drafts only — nothing sends without your approval.</span>
              This is locked on. Auto-send is a future setting, not a toggle you can flip today.
            </p>
          </div>

          <div class="space-y-1.5">
            <Label for="tone">Tone</Label>
            <select
              id="tone"
              name="tone"
              value={data.voice?.tone ?? "professional, warm"}
              class="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
            >
              <option value="professional, warm">Professional, warm (recommended)</option>
              <option value="professional, formal">Professional, formal</option>
              <option value="friendly, casual">Friendly, casual</option>
            </select>
          </div>
          <div class="space-y-1.5">
            <Label for="signoff">Email sign-off</Label>
            <Input id="signoff" name="signoff" value={data.voice?.signoff ?? "Kind regards,"} />
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="businessHours">Business hours</Label>
              <Input
                id="businessHours"
                name="businessHours"
                value={data.voice?.businessHours ?? ""}
                placeholder="Mon–Fri 9am–5pm"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="afterHours">After-hours emergency line</Label>
              <Input
                id="afterHours"
                name="afterHours"
                value={data.voice?.afterHours ?? ""}
                placeholder="+61 7 …"
              />
            </div>
          </div>
          <div class="rounded-lg border border-[hsl(var(--border))] p-3">
            <p class="text-sm font-medium">
              Nominated repairer <span class="text-[hsl(var(--destructive))]">*</span>
            </p>
            <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              QLD requires a nominated repairer for emergency repairs — drafts reference them for
              after-hours emergencies. Required before your first draft.
            </p>
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <Input name="repairerName" placeholder="Repairer / trade business name" required={!data.repairerSet} />
              <Input name="repairerPhone" placeholder="Phone" required={!data.repairerSet} />
            </div>
            {#if data.repairerSet}
              <p class="mt-1.5 flex items-center gap-1 text-xs text-[hsl(var(--success))]">
                <CheckCircle2 class="h-3.5 w-3.5" /> Already set — leave blank to keep it.
              </p>
            {/if}
          </div>
          <div class="space-y-1.5">
            <Label for="houseRules">House rules (optional)</Label>
            <Textarea
              id="houseRules"
              name="houseRules"
              value={data.voice?.extraRules ?? ""}
              placeholder="- Pet requests reviewed within 7 business days&#10;- No rent by credit card"
              class="min-h-[70px]"
            />
          </div>
          <div class="flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save & continue"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {/if}

  <!-- Step 5: First draft -->
  {#if current === "first-draft" && hasAgency}
    <Card class="rounded-2xl p-2">
      <CardHeader>
        <CardTitle class="text-base">Your first AI draft</CardTitle>
        <CardDescription>
          We'll drop a sample tenant email ("no hot water") into your queue and draft the reply —
          so you see exactly what your team gets, before any real email is connected.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        {#if data.firstDraftId}
          <p class="flex items-start gap-2 rounded-lg border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] px-3 py-2 text-sm text-[hsl(var(--success))]">
            <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0" />
            <span>Your first draft is ready.
            <a href={`/queue/${data.firstDraftId}`} class="font-medium text-[hsl(var(--brand))] hover:underline">Open it →</a></span>
          </p>
        {:else}
          <form method="POST" action="?/firstDraft" use:enhance={handle()}>
            <Button type="submit" variant="brand" disabled={busy}>
              {busy ? "Drafting… (about 15 seconds)" : "Create my first draft"}
            </Button>
          </form>
          {#if !data.repairerSet}
            <p class="text-xs text-[hsl(var(--warning))]">
              Set your nominated repairer in step 4 first — drafting won't run without it.
            </p>
          {/if}
        {/if}

        <div class="rounded-lg border border-[hsl(var(--border))] p-3">
          <p class="mb-2 text-sm font-medium">Where you're up to</p>
          <ul class="space-y-1 text-sm">
            <li class="flex items-center gap-1.5">
              <CheckCircle2 class="h-4 w-4 text-[hsl(var(--success))]" /> Agency created
            </li>
            <li class="flex items-center gap-1.5">
              {#if data.mailboxAddress}
                <CheckCircle2 class="h-4 w-4 text-[hsl(var(--success))]" /> Mailbox connected ({data.mailboxAddress})
              {:else}
                <Circle class="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /> Mailbox not connected —
                <button type="button" class="text-[hsl(var(--brand))] hover:underline" onclick={() => (current = "connect-email")}>
                  connect Gmail
                </button>
              {/if}
            </li>
            <li class="flex items-center gap-1.5">
              {#if data.propertyCount > 0}
                <CheckCircle2 class="h-4 w-4 text-[hsl(var(--success))]" /> {data.propertyCount} properties imported
              {:else}
                <Circle class="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /> Portfolio not imported —
                <button type="button" class="text-[hsl(var(--brand))] hover:underline" onclick={() => (current = "import")}>
                  import CSV
                </button>
              {/if}
            </li>
            <li class="flex items-center gap-1.5">
              {#if data.repairerSet}
                <CheckCircle2 class="h-4 w-4 text-[hsl(var(--success))]" /> Nominated repairer set
              {:else}
                <Circle class="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /> Nominated repairer missing —
                <button type="button" class="text-[hsl(var(--brand))] hover:underline" onclick={() => (current = "voice")}>
                  set it
                </button>
              {/if}
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-between">
          <a
            href="mailto:ryanmay065@gmail.com?subject=PM%20Assistant%20setup%20call"
            class="text-sm text-[hsl(var(--brand))] hover:underline"
          >
            Book a 15-min setup call
          </a>
          <Button variant="outline" onclick={() => invalidateAll().then(() => (location.href = "/queue"))}>
            Go to my queue →
          </Button>
        </div>
      </CardContent>
    </Card>
  {/if}
  </div>
</div>
