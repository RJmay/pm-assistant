<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import {
    categoryLabel,
    escalationLabel,
    escalationVariant,
    matchLabel,
    matchVariant,
    priorityLabel,
    priorityVariant,
    relativeTime,
    senderName,
  } from "$lib/format";
  import type { QueueItem } from "$lib/types";
  import { AlertTriangle, ShieldAlert } from "lucide-svelte";

  let { item }: { item: QueueItem } = $props();

  const subject = $derived(item.subject ?? item.draft_subject ?? "(no subject)");
</script>

<a
  href={`/queue/${item.id}`}
  class="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={priorityVariant(item.priority)}>{priorityLabel(item.priority)}</Badge>
        <Badge variant="outline">{categoryLabel(item.category)}</Badge>
        {#if item.escalation_flag !== "NONE"}
          <Badge variant={escalationVariant(item.escalation_flag)}>
            {escalationLabel(item.escalation_flag)}
          </Badge>
        {/if}
        {#if item.emergency_landlord_alert}
          <span class="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertTriangle class="h-3.5 w-3.5" /> Landlord alert
          </span>
        {/if}
        {#if item.safety_critical}
          <span class="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <ShieldAlert class="h-3.5 w-3.5" /> Safety
          </span>
        {/if}
      </div>

      <p class="mt-2 truncate font-medium">{subject}</p>
      <p class="truncate text-sm text-muted-foreground">
        {senderName(item.from_name, item.from_address)}
      </p>
    </div>

    <div class="flex shrink-0 flex-col items-end gap-1.5">
      <span class="text-xs text-muted-foreground">{relativeTime(item.received_at)}</span>
      <Badge variant={matchVariant(item.match_confidence)}>{matchLabel(item.match_confidence)}</Badge>
      {#if item.do_not_send}
        <Badge variant="destructive">Do not send</Badge>
      {/if}
    </div>
  </div>
</a>
