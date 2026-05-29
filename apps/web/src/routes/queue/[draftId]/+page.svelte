<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Dialog } from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { toast } from "$lib/components/ui/sonner";
  import {
    categoryLabel,
    confidenceLabel,
    escalationLabel,
    escalationVariant,
    priorityLabel,
    priorityVariant,
    relativeTime,
    senderName,
  } from "$lib/format";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { env } from "$env/dynamic/public";
  import { ArrowLeft } from "lucide-svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // Editable copy, resynced when navigating to a different draft. The
  // initializers intentionally seed from the loaded draft (for correct SSR
  // values); the $effect below handles re-syncing on client-side nav.
  // svelte-ignore state_referenced_locally
  let subject = $state(data.draft.draft_subject ?? "");
  // svelte-ignore state_referenced_locally
  let body = $state(data.draft.draft_body ?? "");
  // svelte-ignore state_referenced_locally
  let lastDraftId = $state(data.draft.id);
  $effect(() => {
    if (data.draft.id !== lastDraftId) {
      subject = data.draft.draft_subject ?? "";
      body = data.draft.draft_body ?? "";
      lastDraftId = data.draft.id;
    }
  });

  let saving = $state(false);
  let sending = $state(false);
  let discardOpen = $state(false);
  let discardReason = $state("");

  const dirty = $derived(
    subject !== (data.draft.draft_subject ?? "") || body !== (data.draft.draft_body ?? ""),
  );

  async function approveAndSend() {
    const workerUrl = env.PUBLIC_WORKER_URL;
    if (!workerUrl) {
      toast.error("PUBLIC_WORKER_URL is not configured.");
      return;
    }
    sending = true;
    try {
      const supabase = getBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${workerUrl}/api/drafts/${data.draft.id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ subject, body }),
      });
      if (res.ok) {
        toast.success("Draft sent.");
        await invalidateAll();
      } else {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(detail?.error ? `Send failed: ${detail.error}` : `Send failed (${res.status}).`);
      }
    } catch {
      toast.error("Could not reach the Worker.");
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head><title>{data.message?.subject ?? "Draft"} · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <a href="/queue" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft class="h-4 w-4" /> Back to queue
  </a>

  <div class="flex flex-wrap items-center gap-2">
    <Badge variant={priorityVariant(data.draft.priority)}>{priorityLabel(data.draft.priority)}</Badge>
    <Badge variant="outline">{categoryLabel(data.draft.category)}</Badge>
    {#if data.draft.escalation_flag !== "NONE"}
      <Badge variant={escalationVariant(data.draft.escalation_flag)}>
        {escalationLabel(data.draft.escalation_flag)}
      </Badge>
    {/if}
    {#if data.draft.safety_critical}<Badge variant="destructive">Safety critical</Badge>{/if}
    {#if data.draft.emergency_landlord_alert}<Badge variant="destructive">Landlord alert</Badge>{/if}
    {#if data.draft.bounced_at}<Badge variant="destructive">Bounced</Badge>{/if}
    <Badge variant="secondary">Status: {data.draft.status}</Badge>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- Inbound email -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Inbound email</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        {#if data.message}
          <div class="space-y-1 text-sm">
            <p>
              <span class="text-muted-foreground">From:</span>
              {senderName(data.message.from_name, data.message.from_address)}
            </p>
            <p><span class="text-muted-foreground">Subject:</span> {data.message.subject ?? "(none)"}</p>
            <p>
              <span class="text-muted-foreground">Received:</span>
              {relativeTime(data.message.received_at)}
            </p>
          </div>
          <hr class="border-border" />
          {#if data.message.body_plain}
            <p class="whitespace-pre-wrap text-sm leading-relaxed">{data.message.body_plain}</p>
          {:else}
            <p class="text-sm italic text-muted-foreground">
              This email has no plain-text body. Open it in Gmail to view the HTML content.
            </p>
          {/if}
        {:else}
          <p class="text-sm italic text-muted-foreground">Inbound email not found.</p>
        {/if}
      </CardContent>
    </Card>

    <!-- Draft editor -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Draft reply</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if data.draft.bounced_at}
          <p class="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
            This reply <strong>bounced</strong> ({relativeTime(data.draft.bounced_at)}).
            {data.draft.bounce_detail ?? "Delivery failed."} Check the recipient address before resending.
          </p>
        {/if}
        {#if data.draft.do_not_send}
          <p class="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
            The AI flagged this as <strong>do not send</strong>. Review carefully — the body below
            is the recommended approach, not a sendable draft.
          </p>
        {/if}

        <form
          method="POST"
          action="?/saveEdit"
          class="space-y-3"
          use:enhance={() => {
            saving = true;
            return async ({ result, update }) => {
              saving = false;
              if (result.type === "success") {
                const d = result.data as { saved?: boolean; noChanges?: boolean } | undefined;
                if (d?.noChanges) toast.info("No changes to save.");
                else toast.success("Draft saved.");
              } else if (result.type === "failure") {
                toast.error((result.data as { error?: string })?.error ?? "Save failed.");
              }
              await update({ reset: false });
            };
          }}
        >
          <input type="hidden" name="originalSubject" value={data.draft.draft_subject ?? ""} />
          <input type="hidden" name="originalBody" value={data.draft.draft_body ?? ""} />
          <div class="space-y-1.5">
            <Label for="subject">Subject</Label>
            <Input id="subject" name="subject" bind:value={subject} />
          </div>
          <div class="space-y-1.5">
            <Label for="body">Body</Label>
            <Textarea id="body" name="body" bind:value={body} class="min-h-[220px]" />
          </div>
          <div class="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save edit"}
            </Button>
            <Button type="button" onclick={approveAndSend} disabled={sending}>
              {sending ? "Sending…" : "Approve & Send"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              class="ml-auto"
              onclick={() => {
                discardOpen = true;
              }}
            >
              Discard
            </Button>
          </div>
        </form>

        {#if data.draft.pm_review_notes.length > 0}
          <div class="rounded-md border bg-muted/40 p-3">
            <p class="mb-1 text-xs font-semibold uppercase text-muted-foreground">PM review notes</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              {#each data.draft.pm_review_notes as note (note)}
                <li>{note}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <p class="text-xs text-muted-foreground">
          Draft confidence: {confidenceLabel(data.draft.draft_confidence)} · Model:
          {data.draft.model_used}
        </p>
      </CardContent>
    </Card>
  </div>

  <!-- Edit history -->
  {#if data.edits.length > 0}
    <Card>
      <CardHeader><CardTitle class="text-base">Edit history</CardTitle></CardHeader>
      <CardContent class="space-y-2">
        {#each data.edits as edit (edit.id)}
          <div class="text-sm">
            <span class="text-muted-foreground">{relativeTime(edit.edited_at)}</span>
            {#if edit.previous_subject !== edit.new_subject}
              <span> · subject changed</span>
            {/if}
            {#if edit.previous_body !== edit.new_body}<span> · body changed</span>{/if}
          </div>
        {/each}
      </CardContent>
    </Card>
  {/if}
</div>

<Dialog bind:open={discardOpen} title="Discard this draft?" description="It will be removed from the queue. This can't be undone from the dashboard.">
  <form
    method="POST"
    action="?/discard"
    use:enhance={() => {
      return async ({ result }) => {
        if (result.type === "success") {
          toast.success("Draft discarded.");
          discardOpen = false;
          await goto("/queue");
        } else if (result.type === "failure") {
          toast.error((result.data as { error?: string })?.error ?? "Discard failed.");
        }
      };
    }}
  >
    <div class="space-y-1.5">
      <Label for="reason">Reason (optional)</Label>
      <Textarea id="reason" name="reason" bind:value={discardReason} placeholder="e.g. duplicate of another thread" />
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <Button type="button" variant="outline" onclick={() => (discardOpen = false)}>Cancel</Button>
      <Button type="submit" variant="destructive">Discard draft</Button>
    </div>
  </form>
</Dialog>
