<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
</script>

<svelte:head><title>Help · PM Assistant</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-xl font-semibold">How PM Assistant works</h1>
    <p class="text-sm text-muted-foreground">A quick reference for the daily review queue.</p>
  </div>

  <Card>
    <CardHeader><CardTitle class="text-base">The one rule that never changes</CardTitle></CardHeader>
    <CardContent class="text-sm">
      <p>
        PM Assistant <strong>never sends anything on its own</strong>. For every inbound email it
        drafts a reply and puts it in your queue. You review, edit, and send — nothing leaves the
        agency without a person clicking <strong>Approve &amp; Send</strong>.
      </p>
    </CardContent>
  </Card>

  <Card>
    <CardHeader><CardTitle class="text-base">The daily flow</CardTitle></CardHeader>
    <CardContent class="text-sm">
      <ol class="list-decimal space-y-1 pl-5">
        <li><strong>Queue</strong> — prioritised list; highest priority first, then oldest waiting.</li>
        <li><strong>Open a draft</strong> — inbound email on the left (read-only), editable draft on the right.</li>
        <li><strong>Save edit</strong> — keeps changes without sending; recorded in the draft's history.</li>
        <li><strong>Approve &amp; Send</strong> — sends the reply in the original thread from the agency mailbox.</li>
        <li><strong>Discard</strong> — removes a draft with an optional (logged) reason.</li>
      </ol>
    </CardContent>
  </Card>

  <Card>
    <CardHeader><CardTitle class="text-base">What the labels mean</CardTitle></CardHeader>
    <CardContent class="space-y-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">Emergency alert</Badge>
        <Badge>Priority</Badge>
        <Badge variant="secondary">Standard</Badge>
        <span class="text-muted-foreground">— how fast a reply is likely needed.</span>
      </div>
      <p>
        <span class="font-medium">Escalation flags</span> — for sensitive matters the AI writes only
        a brief acknowledgement and flags it for you; it never tries to resolve these:
      </p>
      <ul class="list-disc space-y-1 pl-5">
        <li><strong>Welfare</strong> — self-harm, domestic violence, a death. Follow your welfare process.</li>
        <li><strong>Legal</strong> — QCAT, an RTA dispute, a lawyer, legal action.</li>
        <li><strong>Reputational</strong> — media, police, staff conduct, discrimination.</li>
        <li><strong>Incident</strong> — a notable event needing a record.</li>
      </ul>
      <ul class="list-disc space-y-1 pl-5">
        <li><strong>Safety critical</strong> — property may be unsafe, insecure, or insurance-relevant.</li>
        <li><strong>Landlord alert</strong> — the owner has been / should be alerted out-of-band.</li>
        <li><strong>Do not send</strong> — the AI isn't confident; treat the body as a starting point, not a sendable reply.</li>
        <li><strong>Bounced</strong> — a sent reply couldn't be delivered; check the address and resend.</li>
        <li><strong>Match confidence</strong> — how sure the link to the property/tenant is (High → None). Low/None: double-check the recipient.</li>
      </ul>
    </CardContent>
  </Card>

  <Card>
    <CardHeader><CardTitle class="text-base">Good habits</CardTitle></CardHeader>
    <CardContent class="text-sm">
      <ul class="list-disc space-y-1 pl-5">
        <li>Read the <strong>PM review notes</strong> under each draft — they flag assumptions to check.</li>
        <li>The AI won't commit the owner to money/repairs/timeframes, promise a tradie's arrival time, or give legal advice. Edit out anything that does before sending.</li>
        <li>On a flagged escalation, slow down and involve the right person — the draft is deliberately minimal.</li>
      </ul>
    </CardContent>
  </Card>
</div>
