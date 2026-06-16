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
    Menu,
    MessageSquare,
    ScrollText,
    Settings,
    Wrench,
    X,
  } from "lucide-svelte";
  import type { Icon as IconType } from "lucide-svelte";
  import type { Snippet } from "svelte";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  type NavItem = { href: string; label: string; icon: typeof IconType };
  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: "Workspace",
      items: [
        { href: "/queue", label: "Queue", icon: Inbox },
        { href: "/alerts", label: "Alerts", icon: AlertTriangle },
        { href: "/properties", label: "Properties", icon: Home },
        { href: "/maintenance", label: "Maintenance", icon: Wrench },
        { href: "/documents", label: "Documents", icon: FileText },
        { href: "/sms", label: "SMS", icon: MessageSquare },
      ],
    },
    {
      label: "Account",
      items: [
        { href: "/audit", label: "Audit", icon: ScrollText },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  // Pages rendered WITHOUT the app chrome: the public auth pages and the
  // onboarding wizard (a fresh signup has no agency, so the nav would bounce).
  const BARE_PREFIXES = ["/login", "/signup", "/auth", "/onboarding"];
  const isBare = $derived(
    BARE_PREFIXES.some((p) => page.url.pathname === p || page.url.pathname.startsWith(`${p}/`)),
  );
  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }

  const agencyInitial = $derived((data.agencyName ?? "PM").trim().charAt(0).toUpperCase() || "P");

  // Mobile drawer — closes itself on any navigation.
  let mobileOpen = $state(false);
  $effect(() => {
    page.url.pathname;
    mobileOpen = false;
  });
</script>

<Toaster />

{#if isBare}
  {@render children()}
{:else}
  {#snippet sidebar()}
    <div class="flex h-full flex-col gap-1 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]">
      <!-- Brand -->
      <div class="flex h-16 shrink-0 items-center justify-between px-5 text-white">
        <a href="/queue" class="flex items-center" aria-label="PM Assistant — home">
          <BrandMark size="sm" wordmark />
        </a>
        <button
          type="button"
          class="rounded-md p-1.5 text-[hsl(var(--sidebar-muted))] hover:bg-white/5 hover:text-white lg:hidden"
          aria-label="Close menu"
          onclick={() => (mobileOpen = false)}
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Nav -->
      <nav class="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {#each navGroups as group (group.label)}
          <div class="space-y-1">
            <p
              class="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--sidebar-muted))]"
            >
              {group.label}
            </p>
            {#each group.items as item (item.href)}
              {@const active = isActive(item.href)}
              <a
                href={item.href}
                aria-current={active ? "page" : undefined}
                class={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[hsl(var(--brand)/0.16)] text-white"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-white/[0.06] hover:text-white",
                )}
              >
                {#if active}
                  <span
                    class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[hsl(var(--brand))]"
                    aria-hidden="true"
                  ></span>
                {/if}
                <item.icon
                  class={cn(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    active ? "text-[hsl(var(--brand))]" : "text-[hsl(var(--sidebar-muted))] group-hover:text-white",
                  )}
                />
                {item.label}
              </a>
            {/each}
          </div>
        {/each}
      </nav>

      <!-- Footer: agency identity + actions -->
      <div class="shrink-0 border-t border-[hsl(var(--sidebar-border))] p-3">
        {#if data.isDemo}
          <div
            class="mb-2 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
            Demo workspace
          </div>
        {/if}
        <div class="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white"
          >
            {agencyInitial}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-white">{data.agencyName ?? "PM Assistant"}</p>
            <p class="truncate text-xs text-[hsl(var(--sidebar-muted))]">{data.user?.email ?? ""}</p>
          </div>
        </div>
        <div class="mt-1 flex items-center gap-1">
          <a
            href="/help"
            class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[hsl(var(--sidebar-foreground))] transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <HelpCircle class="h-4 w-4" /> Help
          </a>
          <form method="POST" action="/logout" class="flex-1">
            <button
              type="submit"
              class="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[hsl(var(--sidebar-foreground))] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <LogOut class="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  {/snippet}

  <div class="min-h-screen lg:pl-64">
    <!-- Desktop sidebar (fixed) -->
    <aside class="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-[hsl(var(--sidebar-border))] lg:block">
      {@render sidebar()}
    </aside>

    <!-- Mobile top bar -->
    <header
      class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/0.85)] px-4 backdrop-blur lg:hidden"
    >
      <button
        type="button"
        class="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
        aria-label="Open menu"
        onclick={() => (mobileOpen = true)}
      >
        <Menu class="h-5 w-5" />
      </button>
      <a href="/queue" class="flex items-center" aria-label="PM Assistant — home">
        <BrandMark size="sm" wordmark />
      </a>
      {#if data.isDemo}
        <span
          class="ml-auto rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
        >
          Demo
        </span>
      {/if}
    </header>

    <!-- Mobile drawer -->
    {#if mobileOpen}
      <button
        type="button"
        class="fixed inset-0 z-40 bg-[hsl(222_47%_8%/0.5)] backdrop-blur-sm lg:hidden"
        aria-label="Close menu"
        onclick={() => (mobileOpen = false)}
      ></button>
      <aside class="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl lg:hidden">
        {@render sidebar()}
      </aside>
    {/if}

    <!-- Page content -->
    <main class="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-10 lg:py-9">
      {@render children()}
    </main>

    {#if data.isDemo}
      <DemoPanel scenarios={data.demoScenarios} />
    {/if}
  </div>
{/if}
