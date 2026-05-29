<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Sign in · PM Assistant</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-[hsl(var(--muted))] px-4">
  <Card class="w-full max-w-sm">
    <CardHeader>
      <CardTitle>PM Assistant</CardTitle>
      <CardDescription>Sign in to your agency dashboard.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      {#if form?.error}
        <p
          class="rounded-md bg-[hsl(var(--destructive))] px-3 py-2 text-sm text-[hsl(var(--destructive-foreground))]"
          role="alert"
        >
          {form.error}
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
        <div class="absolute inset-0 flex items-center"><span class="w-full border-t border-[hsl(var(--border))]"></span></div>
        <div class="relative flex justify-center text-xs uppercase">
          <span class="bg-[hsl(var(--card))] px-2 text-[hsl(var(--muted-foreground))]">or</span>
        </div>
      </div>

      <form method="POST" action="?/google" use:enhance>
        <Button type="submit" variant="outline" class="w-full">Continue with Google</Button>
      </form>
    </CardContent>
  </Card>
</div>
