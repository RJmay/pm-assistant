<script lang="ts">
  import BrandMark from "$lib/components/BrandMark.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { AlertTriangle, MailCheck } from "lucide-svelte";

  let email = $state("");
  let sending = $state(false);
  let sent = $state(false);
  let errorMsg = $state<string | null>(null);

  async function sendLink(e: SubmitEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    sending = true;
    errorMsg = null;
    try {
      const supabase = getBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${location.origin}/auth/confirm?next=/onboarding`,
        },
      });
      if (error) {
        errorMsg = error.message;
      } else {
        sent = true;
      }
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head><title>Sign up · PM Assistant</title></svelte:head>

<div class="bg-auth flex min-h-screen flex-col items-center justify-center px-4 py-12">
  <div class="w-full max-w-sm">
    <div class="mb-8 flex flex-col items-center gap-3 text-center">
      <BrandMark size="lg" wordmark />
      <p class="max-w-xs text-sm text-[hsl(var(--muted-foreground))]">
        AI-drafted, QLD-compliant email replies — your team reviews and sends.
      </p>
    </div>

    <div class="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-sm">
      {#if sent}
        <div class="flex flex-col items-center gap-3 py-4 text-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--brand)/0.12)] text-[hsl(var(--brand))]">
            <MailCheck class="h-6 w-6" />
          </span>
          <p class="text-base font-semibold tracking-tight">Check your email</p>
          <p class="text-sm text-[hsl(var(--muted-foreground))]">
            We sent a sign-in link to
            <span class="font-medium text-[hsl(var(--foreground))]">{email}</span>. Click it on this
            device to continue.
          </p>
        </div>
      {:else}
        <div class="mb-6 space-y-1">
          <h2 class="text-xl font-semibold tracking-tight">Start with PM Assistant</h2>
          <p class="text-sm text-[hsl(var(--muted-foreground))]">
            No passwords, no IT. We'll email you a sign-in link and have your agency drafting
            replies in minutes.
          </p>
        </div>

        {#if errorMsg}
          <p
            class="mb-4 flex items-start gap-2 rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-sm text-[hsl(var(--destructive))]"
            role="alert"
          >
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </p>
        {/if}

        <form class="space-y-4" onsubmit={sendLink}>
          <div class="space-y-1.5">
            <Label for="email">Work email</Label>
            <Input
              id="email"
              type="email"
              bind:value={email}
              placeholder="you@youragency.com.au"
              required
              autocomplete="email"
            />
          </div>
          <Button type="submit" variant="brand" class="w-full" disabled={sending}>
            {sending ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </form>
      {/if}
    </div>

    <p class="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
      Already set up? <a href="/login" class="font-medium text-[hsl(var(--brand))] hover:underline">Sign in</a>
    </p>
  </div>
</div>
