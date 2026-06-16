<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import BrandMark from "$lib/components/BrandMark.svelte";
  import DemoPanel from "$lib/components/DemoPanel.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import { cn } from "$lib/utils";
  import {
    AlertTriangle,
    FileText,
    HelpCircle,
    Home,
    Inbox,
    LogOut,
    MessageSquare,
    ScrollText,
    Settings,
    Wrench,
  } from "lucide-svelte";
  import type { Snippet } from "svelte";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const navItems = [
    { href: "/queue", label: "Queue", icon: Inbox },
    { href: "/alerts", label: "Alerts", icon: AlertTriangle },
    { href: "/properties", label: "Properties", icon: Home },
    { href: "/maintenance", label: "Maintenance", icon: Wrench },
    { href: "/documents", label: "Documents", icon: FileText },
    { href: "/sms", label: "SMS", icon: MessageSquare },
    { href: "/audit", label: "Audit", icon: ScrollText },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  // Pages rendered WITHOUT the app chrome (nav/sign-out): the public auth
  // pages and the onboarding wizard (a fresh signup has no agency, so the nav
  // links would all bounce back to /onboarding anyway).
  const BARE_PREFIXES = ["/login", "/signup", "/auth", "/onboarding"];
  const isBare = $derived(
    BARE_PREFIXES.some((p) => page.url.pathname === p || page.url.pathname.startsWith(`${p}/`)),
  );
  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }
</script>

<Toaster />

{#if isBare}
  {@render children()}
{:else}
  <div class="flex min-h-screen flex-col">
    <!-- Top bar -->
    <header
      class="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70"
    >
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div class="flex items-center gap-5">
          <a href="/queue" class="shrink-0" aria-label="PM Assistant — home">
            <BrandMark size="sm" wordmark class="hidden sm:inline-flex" />
            <BrandMark size="sm" class="sm:hidden" />
          </a>
          <!-- Desktop nav -->
          <nav class="hidden items-center gap-0.5 sm:flex">
            {#each navItems as item (item.href)}
              <a
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                class={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <item.icon class="h-4 w-4" />
                {item.label}
              </a>
            {/each}
          </nav>
        </div>
        <div class="flex items-center gap-1.5">
          {#if data.agencyName}
            <span class="mr-1 hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
              {data.agencyName}
              {#if data.isDemo}
                <span
                  class="rounded-full border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                >
                  Demo
                </span>
              {/if}
            </span>
            <span class="mr-1 hidden h-5 w-px bg-border sm:block"></span>
          {/if}
          <a
            href="/help"
            class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            aria-label="Help"
          >
            <HelpCircle class="h-4 w-4" />
            <span class="hidden sm:inline">Help</span>
          </a>
          <form method="POST" action="/logout">
            <button
              type="submit"
              class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut class="h-4 w-4" />
              <span class="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>

    <!-- Page content -->
    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-20 sm:pb-6">
      {@render children()}
    </main>

    {#if data.isDemo}
      <DemoPanel scenarios={data.demoScenarios} />
    {/if}

    <!-- Mobile bottom nav: icon-only (8 labels won't fit at 390px), active tab
         gets a teal pill. grid-cols must equal navItems.length. -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-8 border-t bg-background/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {#each navItems as item (item.href)}
        <a
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          aria-label={item.label}
          class="flex flex-col items-center justify-center py-1.5"
        >
          <span
            class={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
              isActive(item.href)
                ? "bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
                : "text-muted-foreground",
            )}
          >
            <item.icon class="h-5 w-5" />
          </span>
        </a>
      {/each}
    </nav>
  </div>
{/if}
