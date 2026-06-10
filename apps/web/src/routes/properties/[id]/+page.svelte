<script lang="ts">
  import { enhance } from "$app/forms";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Dialog } from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { toast } from "$lib/components/ui/sonner";
  import {
    formatDate,
    formatMoney,
    jobStateLabel,
    relativeTime,
    rentLabel,
    tenancyStatusLabel,
    tenancyStatusVariant,
  } from "$lib/format";
  import { inspectionState, nextInspectionDue } from "$lib/rent-roll";
  import type { MaintenanceJobState } from "$lib/types";
  import { AlertTriangle, Pencil } from "lucide-svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import type { PageData } from "./$types";
  import type { TenancyDetail, TenantDetail } from "$lib/server/rent-roll";

  let { data }: { data: PageData } = $props();

  const address = $derived(
    [data.property.address_line1, data.property.address_line2, data.property.suburb]
      .filter((p) => p && p.trim() !== "")
      .join(", "),
  );

  // Dialog state — boolean flags bound to the Dialog (so Escape/X/backdrop
  // closes stay in sync), with the edit target held alongside.
  let ownerOpen = $state(false);
  let tenancyOpen = $state(false);
  let editingTenancy = $state<TenancyDetail | null>(null);
  let tenantOpen = $state(false);
  let editingTenant = $state<TenantDetail | null>(null);

  function openTenancy(t: TenancyDetail) {
    editingTenancy = t;
    tenancyOpen = true;
  }
  function openTenant(t: TenantDetail) {
    editingTenant = t;
    tenantOpen = true;
  }

  /** Shared enhance handler: toast + refresh, optionally closing a dialog. */
  function handle(message: string, onSuccess?: () => void): SubmitFunction {
    return () => {
      return async ({ result, update }) => {
        if (result.type === "success") {
          toast.success(message);
          onSuccess?.();
        } else if (result.type === "failure") {
          toast.error((result.data as { error?: string })?.error ?? "Save failed.");
        }
        await update({ reset: false });
      };
    };
  }

  function inspectionBadge(t: TenancyDetail): { label: string; destructive: boolean } | null {
    if (t.status !== "active") return null;
    const due = nextInspectionDue(t);
    const state = inspectionState(due, data.today);
    if (state === "overdue") return { label: `Inspection overdue (due ${formatDate(due)})`, destructive: true };
    if (state === "due_soon") return { label: `Inspection due ${formatDate(due)}`, destructive: false };
    return null;
  }
</script>

<svelte:head><title>{data.property.address_line1} · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <a href="/properties" class="text-sm text-muted-foreground hover:text-foreground">
    ← All properties
  </a>

  <div>
    <h1 class="text-2xl font-semibold tracking-tight">{address}</h1>
    <p class="text-sm text-muted-foreground">
      {[data.property.suburb, data.property.state, data.property.postcode]
        .filter((p) => p && p.trim() !== "")
        .join(" ")}
    </p>
    {#if data.property.notes}
      <p class="mt-1 text-sm text-muted-foreground">{data.property.notes}</p>
    {/if}
  </div>

  <!-- Owner -->
  <Card>
    <CardHeader class="flex-row items-center justify-between space-y-0">
      <div>
        <CardTitle class="text-base">Owner</CardTitle>
        <CardDescription>Emergency alerts and approval requests go here.</CardDescription>
      </div>
      {#if data.owner}
        <Button variant="outline" size="sm" onclick={() => (ownerOpen = true)}>
          <Pencil class="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
      {/if}
    </CardHeader>
    <CardContent>
      {#if data.owner}
        <p class="font-medium">{data.owner.full_name}</p>
        <p class="text-sm text-muted-foreground">
          {data.owner.email ?? "No email"} · {data.owner.phone ?? "No phone"}
        </p>
      {:else}
        <p class="text-sm text-muted-foreground">No owner is linked to this property.</p>
      {/if}
    </CardContent>
  </Card>

  <!-- Tenancies -->
  {#each data.tenancies as tenancy (tenancy.id)}
    {@const inspection = inspectionBadge(tenancy)}
    <Card>
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex flex-wrap items-center gap-2">
          <CardTitle class="text-base">Tenancy</CardTitle>
          <Badge variant={tenancyStatusVariant(tenancy.status)}>
            {tenancyStatusLabel(tenancy.status)}
          </Badge>
          {#if tenancy.arrears_since}
            <Badge variant="destructive">
              <AlertTriangle class="mr-1 h-3.5 w-3.5" />
              Arrears since {formatDate(tenancy.arrears_since)}
            </Badge>
          {/if}
          {#if inspection}
            <Badge variant={inspection.destructive ? "destructive" : "outline"}>
              {inspection.label}
            </Badge>
          {/if}
        </div>
        <Button variant="outline" size="sm" onclick={() => openTenancy(tenancy)}>
          <Pencil class="mr-1.5 h-3.5 w-3.5" /> Edit terms
        </Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-muted-foreground">Rent</dt>
            <dd class="font-medium">{rentLabel(tenancy.rent_amount_cents, tenancy.rent_frequency)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Lease</dt>
            <dd class="font-medium">
              {formatDate(tenancy.start_date)} → {tenancy.end_date
                ? formatDate(tenancy.end_date)
                : tenancy.agreement_type === "periodic"
                  ? "Periodic"
                  : "—"}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Bond</dt>
            <dd class="font-medium">
              {formatMoney(tenancy.bond_amount_cents)}
              {#if tenancy.bond_rta_reference}
                <span class="text-muted-foreground">({tenancy.bond_rta_reference})</span>
              {/if}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Last inspection</dt>
            <dd class="font-medium">{formatDate(tenancy.last_routine_inspection_date)}</dd>
          </div>
        </dl>

        {#if tenancy.status === "active" || tenancy.status === "ending"}
          <div class="flex flex-wrap items-end gap-4 rounded-md border bg-muted/30 p-3">
            <!-- Record inspection: rolls the next inspection cycle forward -->
            <form
              method="POST"
              action="?/recordInspection"
              class="flex items-end gap-2"
              use:enhance={handle("Inspection recorded.")}
            >
              <input type="hidden" name="tenancyId" value={tenancy.id} />
              <div class="space-y-1">
                <Label for={`inspection-${tenancy.id}`} class="text-xs">Inspection done on</Label>
                <Input
                  id={`inspection-${tenancy.id}`}
                  name="date"
                  type="date"
                  value={data.today}
                  class="h-8 w-40"
                />
              </div>
              <Button type="submit" variant="outline" size="sm">Record inspection</Button>
            </form>

            <!-- Arrears flag: drives the daily arrears reminder sequence -->
            {#if tenancy.arrears_since}
              <form
                method="POST"
                action="?/clearArrears"
                use:enhance={handle("Arrears cleared.")}
              >
                <input type="hidden" name="tenancyId" value={tenancy.id} />
                <Button type="submit" variant="outline" size="sm">Clear arrears (caught up)</Button>
              </form>
            {:else}
              <form
                method="POST"
                action="?/setArrears"
                class="flex items-end gap-2"
                use:enhance={handle("Arrears flagged — a reminder will be drafted.")}
              >
                <input type="hidden" name="tenancyId" value={tenancy.id} />
                <div class="space-y-1">
                  <Label for={`arrears-${tenancy.id}`} class="text-xs">Rent behind since</Label>
                  <Input
                    id={`arrears-${tenancy.id}`}
                    name="date"
                    type="date"
                    value={data.today}
                    class="h-8 w-40"
                  />
                </div>
                <Button type="submit" variant="outline" size="sm">Mark in arrears</Button>
              </form>
            {/if}
          </div>
        {/if}

        <!-- Tenants on this tenancy -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Tenants</h3>
          {#if tenancy.tenants.length === 0}
            <p class="text-sm text-muted-foreground">No tenants recorded for this tenancy.</p>
          {:else}
            <ul class="space-y-2">
              {#each tenancy.tenants as tenant (tenant.id)}
                <li class="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {tenant.full_name}
                      {#if tenant.is_primary}
                        <Badge variant="outline" class="ml-1">Primary</Badge>
                      {/if}
                    </p>
                    <p class="truncate text-sm text-muted-foreground">
                      {tenant.email ?? "No email"} · {tenant.phone ?? "No phone"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onclick={() => openTenant(tenant)}>
                    <Pencil class="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                </li>
              {/each}
            </ul>
            <p class="mt-2 text-xs text-muted-foreground">
              The tenant's email is how inbound messages are matched to this property — keep it
              current.
            </p>
          {/if}
        </div>
      </CardContent>
    </Card>
  {:else}
    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-muted-foreground">No tenancies recorded for this property.</p>
      </CardContent>
    </Card>
  {/each}

  <!-- Recent activity -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Recent activity</CardTitle>
      <CardDescription>Drafts, maintenance jobs and documents linked to this property.</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-6 sm:grid-cols-3">
      <div>
        <h3 class="mb-2 text-sm font-medium">Drafts</h3>
        {#if data.activity.drafts.length === 0}
          <p class="text-sm text-muted-foreground">None yet.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each data.activity.drafts as item (item.id)}
              <li>
                <a href={`/queue/${item.id}`} class="block truncate text-sm hover:underline">
                  {item.title}
                </a>
                <span class="text-xs text-muted-foreground">{relativeTime(item.when)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div>
        <h3 class="mb-2 text-sm font-medium">Maintenance</h3>
        {#if data.activity.jobs.length === 0}
          <p class="text-sm text-muted-foreground">None yet.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each data.activity.jobs as item (item.id)}
              <li>
                <a href={`/maintenance/${item.id}`} class="block truncate text-sm hover:underline">
                  {item.title}
                </a>
                <span class="text-xs text-muted-foreground">
                  {item.badge ? jobStateLabel(item.badge as MaintenanceJobState) : ""} ·
                  {relativeTime(item.when)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div>
        <h3 class="mb-2 text-sm font-medium">Documents</h3>
        {#if data.activity.documents.length === 0}
          <p class="text-sm text-muted-foreground">None yet.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each data.activity.documents as item (item.id)}
              <li>
                <a href={`/documents/${item.id}`} class="block truncate text-sm hover:underline">
                  {item.title}
                </a>
                <span class="text-xs text-muted-foreground">{relativeTime(item.when)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </CardContent>
  </Card>
</div>

<!-- Edit owner -->
<Dialog bind:open={ownerOpen} title="Edit owner">
  {#if data.owner}
    <form
      method="POST"
      action="?/updateOwner"
      class="space-y-3"
      use:enhance={handle("Owner updated.", () => (ownerOpen = false))}
    >
      <input type="hidden" name="ownerId" value={data.owner.id} />
      <div class="space-y-1.5">
        <Label for="owner-name">Full name</Label>
        <Input id="owner-name" name="fullName" value={data.owner.full_name} required />
      </div>
      <div class="space-y-1.5">
        <Label for="owner-email">Email</Label>
        <Input id="owner-email" name="email" type="email" value={data.owner.email ?? ""} />
      </div>
      <div class="space-y-1.5">
        <Label for="owner-phone">Phone</Label>
        <Input id="owner-phone" name="phone" value={data.owner.phone ?? ""} />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => (ownerOpen = false)}>Cancel</Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  {/if}
</Dialog>

<!-- Edit tenancy terms -->
<Dialog bind:open={tenancyOpen} title="Edit tenancy terms">
  {#if editingTenancy}
    <form
      method="POST"
      action="?/updateTenancy"
      class="space-y-3"
      use:enhance={handle("Tenancy updated.", () => (tenancyOpen = false))}
    >
      <input type="hidden" name="tenancyId" value={editingTenancy.id} />
      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <Label for="rent-dollars">Rent (AUD)</Label>
          <Input
            id="rent-dollars"
            name="rentDollars"
            type="number"
            min="0"
            step="0.01"
            value={editingTenancy.rent_amount_cents !== null
              ? editingTenancy.rent_amount_cents / 100
              : ""}
          />
        </div>
        <div class="space-y-1.5">
          <Label for="rent-frequency">Frequency</Label>
          <select
            id="rent-frequency"
            name="rentFrequency"
            value={editingTenancy.rent_frequency ?? ""}
            class="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">—</option>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="space-y-1.5">
          <Label for="start-date">Lease start</Label>
          <Input id="start-date" name="startDate" type="date" value={editingTenancy.start_date ?? ""} />
        </div>
        <div class="space-y-1.5">
          <Label for="end-date">Lease end</Label>
          <Input id="end-date" name="endDate" type="date" value={editingTenancy.end_date ?? ""} />
        </div>
      </div>
      <p class="text-xs text-muted-foreground">
        The lease end date drives renewal reminders; leave it blank for a periodic tenancy.
      </p>
      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => (tenancyOpen = false)}>Cancel</Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  {/if}
</Dialog>

<!-- Edit tenant -->
<Dialog bind:open={tenantOpen} title="Edit tenant">
  {#if editingTenant}
    <form
      method="POST"
      action="?/updateTenant"
      class="space-y-3"
      use:enhance={handle("Tenant updated.", () => (tenantOpen = false))}
    >
      <input type="hidden" name="tenantId" value={editingTenant.id} />
      <div class="space-y-1.5">
        <Label for="tenant-name">Full name</Label>
        <Input id="tenant-name" name="fullName" value={editingTenant.full_name} required />
      </div>
      <div class="space-y-1.5">
        <Label for="tenant-email">Email</Label>
        <Input id="tenant-email" name="email" type="email" value={editingTenant.email ?? ""} />
        <p class="text-xs text-muted-foreground">Used to match inbound emails to this property.</p>
      </div>
      <div class="space-y-1.5">
        <Label for="tenant-phone">Phone</Label>
        <Input id="tenant-phone" name="phone" value={editingTenant.phone ?? ""} />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => (tenantOpen = false)}>Cancel</Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  {/if}
</Dialog>
