<script lang="ts">
  import { enhance } from "$app/forms";
  import BrandMark from "$lib/components/BrandMark.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { AlertTriangle } from "lucide-svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Sign in · PM Assistant</title></svelte:head>

<div
  class="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-background to-[hsl(var(--accent))] px-4 py-10"
>
  <!-- Brand lockup + value prop: sells the product before login -->
  <div class="flex flex-col items-center gap-3 text-center">
    <BrandMark size="lg" wordmark />
    <p class="max-w-xs text-sm text-muted-foreground">
      AI-drafted, QLD-compliant email replies — your team reviews and sends.
    </p>
  </div>

  <Card class="w-full max-w-sm shadow-lg">
    <CardHeader>
      <CardTitle>Welcome back</CardTitle>
      <CardDescription>Sign in to your agency dashboard.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      {#if form?.error}
        <p
          class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{form.error}</span>
        </p>
      {/if}

      <form
        method="POST"
        action="?/login"
        class="space-y-3"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
      >
        <div class="space-y-1.5">
          <Label for="email">Email</Label>
          <Input id="email" name="email" type="email" autocomplete="email" required value={form?.email ?? ""} />
        </div>
        <div class="space-y-1.5">
          <Label for="password">Password</Label>
          <Input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <Button type="submit" class="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div class="relative">
        <div class="absolute inset-0 flex items-center"><span class="w-full border-t"></span></div>
        <div class="relative flex justify-center text-xs uppercase">
          <span class="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form method="POST" action="?/google" use:enhance>
        <Button type="submit" variant="outline" class="w-full">Continue with Google</Button>
      </form>
    </CardContent>
  </Card>

  <p class="text-xs text-muted-foreground">
    For Queensland residential property management agencies.
  </p>
</div>
