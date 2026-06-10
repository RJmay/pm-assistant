<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { formatDate, rentLabel, tenancyStatusLabel, tenancyStatusVariant } from "$lib/format";
  import { inspectionState, type PropertyListItem } from "$lib/rent-roll";
  import { AlertTriangle } from "lucide-svelte";

  let { item, today }: { item: PropertyListItem; today: string } = $props();

  const address = $derived(
    [item.addressLine1, item.suburb].filter((p) => p && p.trim() !== "").join(", "),
  );
  const inspection = $derived(inspectionState(item.inspectionDue, today));
</script>

<a
  href={`/properties/${item.id}`}
  class="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        {#if item.tenancyStatus}
          <Badge variant={tenancyStatusVariant(item.tenancyStatus)}>
            {tenancyStatusLabel(item.tenancyStatus)}
          </Badge>
        {:else}
          <Badge variant="outline">Vacant</Badge>
        {/if}
        {#if item.arrearsSince}
          <Badge variant="destructive">
            <AlertTriangle class="mr-1 h-3.5 w-3.5" />
            Arrears since {formatDate(item.arrearsSince)}
          </Badge>
        {/if}
        {#if inspection === "overdue"}
          <Badge variant="destructive">Inspection overdue</Badge>
        {:else if inspection === "due_soon"}
          <Badge variant="outline">Inspection due {formatDate(item.inspectionDue)}</Badge>
        {/if}
      </div>

      <p class="mt-2 truncate font-medium">{address}</p>
      <p class="truncate text-sm text-muted-foreground">
        {item.tenantNames.length > 0 ? item.tenantNames.join(", ") : "No tenants"}
        {#if item.ownerName}
          · Owner: {item.ownerName}
        {/if}
      </p>
    </div>

    <div class="flex shrink-0 flex-col items-end gap-1.5">
      <span class="text-sm font-medium">{rentLabel(item.rentCents, item.rentFrequency)}</span>
      {#if item.endDate}
        <span class="text-xs text-muted-foreground">Lease ends {formatDate(item.endDate)}</span>
      {/if}
    </div>
  </div>
</a>
