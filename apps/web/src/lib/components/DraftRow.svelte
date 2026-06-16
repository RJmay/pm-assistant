<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import {
    categoryLabel,
    draftStatusLabel,
    draftStatusVariant,
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
  import { cn } from "$lib/utils";
  import { AlertTriangle, ChevronRight, ShieldAlert } from "lucide-svelte";

  let { item }: { item: QueueItem } = $props();

  const subject = $derived(item.subject ?? item.draft_subject ?? "(no subject)");
  const isOutbound = $derived(item.draft_source !== "inbound_reply");
  const needsAttention = $derived(item.do_not_send || item.bounced_at !== null);
  // At-a-glance triage: a coloured left edge keyed to priority (no logic change).
  const accent = $derived(
    item.priority === "EMERGENCY_ALERT"
      ? "border-l-[hsl(var(--destructive))]"
      : item.priority === "PRIORITY"
        ? "border-l-[hsl(var(--warning))]"
        : "border-l-transparent",
  );
</script>

<a
  href={`/queue/${item.id}`}
  class={cn(
    "group block rounded-xl border border-l-[3px] border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm transition-all hover:-translate-y-px hover:border-[hsl(var(--brand)/0.4)] hover:shadow-md",
    accent,
    needsAttention && "border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.04)]",
  )}
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge variant={priorityVariant(item.priority)}>{priorityLabel(item.priority)}</Badge>
        <Badge variant="outline">{categoryLabel(item.category)}</Badge>
        {#if isOutbound}
          <Badge variant="secondary">Outbound</Badge>
        {/if}
        {#if item.status !== "pending"}
          <Badge variant={draftStatusVariant(item.status)}>{draftStatusLabel(item.status)}</Badge>
        {/if}
        {#if item.escalation_flag !== "NONE"}
          <Badge variant={escalationVariant(item.escalation_flag)}>
            {escalationLabel(item.escalation_flag)}
          </Badge>
        {/if}
        {#if item.emergency_landlord_alert}
          <Badge variant="destructive"><AlertTriangle class="mr-1 h-3 w-3" />Landlord alert</Badge>
        {/if}
        {#if item.safety_critical}
          <Badge variant="destructive"><ShieldAlert class="mr-1 h-3 w-3" />Safety</Badge>
        {/if}
      </div>

      <p class="mt-2 truncate text-[15px] font-semibold">{subject}</p>
      <p class="truncate text-sm text-muted-foreground">
        {isOutbound ? "To: " : ""}{senderName(item.from_name, item.from_address)}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <div class="flex flex-col items-end gap-1.5">
        <span class="text-xs text-muted-foreground">{relativeTime(item.received_at)}</span>
        <Badge variant={matchVariant(item.match_confidence)}>{matchLabel(item.match_confidence)}</Badge>
        {#if item.do_not_send}
          <Badge variant="destructive">Do not send</Badge>
        {/if}
        {#if item.bounced_at}
          <Badge variant="destructive">Bounced</Badge>
        {/if}
      </div>
      <ChevronRight
        class="h-4 w-4 shrink-0 self-center text-muted-foreground/30 transition-colors group-hover:text-muted-foreground"
      />
    </div>
  </div>
</a>
