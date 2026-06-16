<script lang="ts">
  import { enhance } from "$app/forms";
  import BrandMark from "$lib/components/BrandMark.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { AlertTriangle, MailCheck, Scale, ShieldCheck } from "lucide-svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);

  const points = [
    { icon: MailCheck, text: "AI-drafted replies for every inbound tenant, owner and tradie email." },
    { icon: Scale, text: "Grounded in QLD residential tenancy law — RTRA Act 2008 + 2024/25 reforms." },
    { icon: ShieldCheck, text: "Nothing sends until a property manager reviews and approves it." },
  ];
</script>

<svelte:head><title>Sign in · PM Assistant</title></svelte:head>

<div class="grid min-h-screen lg:grid-cols-2">
  <!-- Brand panel (desktop only) -->
  <div class="relative hidden flex-col justify-between overflow-hidden bg-[hsl(var(--sidebar))] p-12 text-white lg:flex">
    <div
      class="pointer-events-none absolute inset-0 opacity-90"
      style="background-image: radial-gradient(40rem 30rem at 15% 0%, hsl(214 90% 52% / 0.22), transparent 60%), radial-gradient(40rem 30rem at 100% 100%, hsl(221 83% 45% / 0.18), transparent 55%);"
    ></div>
    <div class="relative">
      <BrandMark size="md" wordmark />
    </div>
    <div class="relative space-y-8">
      <h1 class="max-w-md text-3xl font-semibold leading-tight tracking-tight">
        The daily email queue, drafted for you — reviewed by you.
      </h1>
      <ul class="space-y-4">
        {#each points as p (p.text)}
          <li class="flex items-start gap-3 text-sm text-[hsl(var(--sidebar-foreground))]">
            <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[hsl(var(--brand))]">
              <p.icon class="h-4 w-4" />
            </span>
            <span class="leading-relaxed">{p.text}</span>
          </li>
        {/each}
      </ul>
    </div>
    <p class="relative text-xs text-[hsl(var(--sidebar-muted))]">
      For Queensland residential property management agencies.
    </p>
  </div>

  <!-- Form panel -->
  <div class="bg-auth flex flex-col items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
        <BrandMark size="lg" wordmark />
        <p class="max-w-xs text-sm text-[hsl(var(--muted-foreground))]">
          AI-drafted, QLD-compliant email replies — your team reviews and sends.
        </p>
      </div>

      <div class="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-sm">
        <div class="mb-6 space-y-1">
          <h2 class="text-xl font-semibold tracking-tight">Welcome back</h2>
          <p class="text-sm text-[hsl(var(--muted-foreground))]">Sign in to your agency dashboard.</p>
        </div>

        {#if form?.error}
          <p
            class="mb-4 flex items-start gap-2 rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-sm text-[hsl(var(--destructive))]"
            role="alert"
          >
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{form.error}</span>
          </p>
        {/if}

        <form
          method="POST"
          action="?/login"
          class="space-y-4"
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

        <div class="relative my-5">
          <div class="absolute inset-0 flex items-center"><span class="w-full border-t border-[hsl(var(--border))]"></span></div>
          <div class="relative flex justify-center text-xs uppercase tracking-wide">
            <span class="bg-[hsl(var(--card))] px-2 text-[hsl(var(--muted-foreground))]">or</span>
          </div>
        </div>

        <form method="POST" action="?/google" use:enhance>
          <Button type="submit" variant="outline" class="w-full">Continue with Google</Button>
        </form>
      </div>

      <p class="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
        New agency? <a href="/signup" class="font-medium text-[hsl(var(--brand))] hover:underline">Start onboarding</a>
      </p>
    </div>
  </div>
</div>
