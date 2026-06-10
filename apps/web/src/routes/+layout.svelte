<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
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
    <header class="sticky top-0 z-30 border-b bg-background">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div class="flex items-center gap-6">
          <a href="/queue" class="font-semibold">PM Assistant</a>
          <!-- Desktop nav -->
          <nav class="hidden items-center gap-1 sm:flex">
            {#each navItems as item (item.href)}
              <a
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                class={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon class="h-4 w-4" />
                {item.label}
              </a>
            {/each}
          </nav>
        </div>
        <div class="flex items-center gap-3">
          {#if data.agencyName}
            <span class="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
              {data.agencyName}
              {#if data.isDemo}
                <span
                  class="rounded-full border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                >
                  Demo
                </span>
              {/if}
            </span>
          {/if}
          <a
            href="/help"
            class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Help"
          >
            <HelpCircle class="h-4 w-4" />
            <span class="hidden sm:inline">Help</span>
          </a>
          <form method="POST" action="/logout">
            <button
              type="submit"
              class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
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

    <!-- Mobile bottom nav (grid-cols must equal navItems.length) -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-8 border-t bg-background sm:hidden"
    >
      {#each navItems as item (item.href)}
        <a
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          class={cn(
            "flex flex-col items-center gap-1 py-2 text-xs",
            isActive(item.href) ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <item.icon class="h-5 w-5" />
          {item.label}
        </a>
      {/each}
    </nav>
  </div>
{/if}
