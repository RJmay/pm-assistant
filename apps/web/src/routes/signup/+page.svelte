<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { getBrowserClient } from "$lib/supabase-browser";
  import { MailCheck } from "lucide-svelte";

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

<div class="flex min-h-screen items-center justify-center bg-muted/30 px-4">
  <Card class="w-full max-w-sm">
    <CardHeader>
      <CardTitle>Start with PM Assistant</CardTitle>
      <CardDescription>
        No passwords, no IT. We'll email you a sign-in link and have your agency drafting replies
        in minutes.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if sent}
        <div class="flex flex-col items-center gap-2 py-4 text-center">
          <MailCheck class="h-8 w-8 text-primary" />
          <p class="font-medium">Check your email</p>
          <p class="text-sm text-muted-foreground">
            We sent a sign-in link to <span class="font-medium">{email}</span>. Click it on this
            device to continue.
          </p>
        </div>
      {:else}
        <form class="space-y-3" onsubmit={sendLink}>
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
          {#if errorMsg}
            <p class="text-sm text-destructive">{errorMsg}</p>
          {/if}
          <Button type="submit" class="w-full" disabled={sending}>
            {sending ? "Sending…" : "Email me a sign-in link"}
          </Button>
          <p class="text-center text-xs text-muted-foreground">
            Already set up? <a href="/login" class="underline">Sign in</a>
          </p>
        </form>
      {/if}
    </CardContent>
  </Card>
</div>
