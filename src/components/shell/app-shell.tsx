"use client";

import {
  ClipboardList,
  Home,
  Inbox,
  Landmark,
  List,
  Repeat,
  Search,
  Settings,
  Sparkles,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type RouteKey = "dashboard" | "transactions" | "agentInbox" | "review" | "recurring" | "accounts" | "settings";

type RouteMeta = {
  eyebrow: string;
  icon: LucideIcon;
  label: string;
  title: string;
};

const routeHref: Record<RouteKey, string> = {
  accounts: "/accounts",
  agentInbox: "/agent-inbox",
  dashboard: "/dashboard",
  recurring: "/recurring",
  review: "/review",
  settings: "/settings",
  transactions: "/transactions"
};

const routeMeta: Record<RouteKey, RouteMeta> = {
  dashboard: {
    eyebrow: "Connected finance workspace",
    icon: Home,
    label: "Dashboard",
    title: "Dashboard"
  },
  transactions: {
    eyebrow: "All accounts",
    icon: List,
    label: "Transactions",
    title: "Transactions"
  },
  agentInbox: {
    eyebrow: "Proposed finance changes",
    icon: ClipboardList,
    label: "Agent inbox",
    title: "Agent inbox"
  },
  review: {
    eyebrow: "Items needing your attention",
    icon: Inbox,
    label: "Review",
    title: "Review queue"
  },
  recurring: {
    eyebrow: "Subscriptions and fixed costs",
    icon: Repeat,
    label: "Recurring",
    title: "Recurring"
  },
  accounts: {
    eyebrow: "Connected institutions",
    icon: Landmark,
    label: "Accounts",
    title: "Accounts"
  },
  settings: {
    eyebrow: "Workspace and access",
    icon: Settings,
    label: "Settings",
    title: "Settings"
  }
};

const navigation: RouteKey[] = ["dashboard", "transactions", "agentInbox", "review", "recurring", "accounts", "settings"];
const primaryNavigation: RouteKey[] = ["dashboard", "transactions", "review", "recurring", "accounts", "settings"];

function currentRoute(pathname: string): RouteKey {
  const match = navigation.find((route) => pathname === routeHref[route] || pathname.startsWith(`${routeHref[route]}/`));
  return match ?? "dashboard";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const route = currentRoute(pathname);
  const isTransactionList = pathname === routeHref.transactions;
  const currentTransactionSearch = isTransactionList ? searchParams.get("q") ?? "" : "";
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shouldRefocusSearchRef = useRef(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const focusSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    focusSearchInput();
  }, [focusSearchInput]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;

      event.preventDefault();
      openSearch();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (!shouldRefocusSearchRef.current) return;

    shouldRefocusSearchRef.current = false;
    setIsSearchOpen(true);
    focusSearchInput();
  }, [currentTransactionSearch, focusSearchInput, pathname]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("q") ?? "").trim();
    const params = isTransactionList
      ? new URLSearchParams(searchParams.toString())
      : new URLSearchParams();

    if (query) {
      params.set("q", query);
    } else {
      params.delete("q");
    }

    const serialized = params.toString();
    shouldRefocusSearchRef.current = true;
    router.push(`${routeHref.transactions}${serialized ? `?${serialized}` : ""}`);
  }

  return (
    <div className="ledger-app">
      <aside className="sidebar">
        <Link className="brand" href={routeHref.dashboard} aria-label="Ledger dashboard">
          <div className="brand-mark">L</div>
          <div className="brand-name">Ledger</div>
          <div className="brand-sub">Personal</div>
        </Link>

        <nav className="nav" aria-label="Main navigation">
          {primaryNavigation.map((item) => {
            const Icon = routeMeta[item].icon;
            const active = route === item;
            return (
              <Link
                key={item}
                aria-current={active ? "page" : undefined}
                className={`nav-item ${active ? "active" : ""}`}
                href={routeHref[item]}
              >
                <Icon size={16} aria-hidden />
                <span>{routeMeta[item].label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="ai-card">
            <div className="ai-card-head">
              <Sparkles size={14} aria-hidden />
              <span>AI suggestions</span>
            </div>
            <div className="ai-card-body">High-confidence imports clean themselves up. Exceptions wait in review.</div>
            <Link className="ai-card-link" href={routeHref.review}>Open review queue</Link>
          </div>
          <Link className="user-row" href={routeHref.settings}>
            <div className="avatar">J</div>
            <div className="user-meta">
              <div className="user-name">James</div>
              <div className="user-sub">Real data workspace</div>
            </div>
            <Settings size={15} aria-hidden />
          </Link>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="topbar-eyebrow">{routeMeta[route].eyebrow}</div>
            <h1 className="topbar-title">{routeMeta[route].title}</h1>
          </div>
          <div className="topbar-actions">
            <button
              aria-controls="mobile-transaction-search"
              aria-expanded={isSearchOpen}
              aria-label="Open transaction search"
              className="mobile-search-trigger"
              onClick={openSearch}
              type="button"
            >
              <Search size={15} aria-hidden />
              <span>Search</span>
            </button>
            <div className={`search-layer ${isSearchOpen ? "search-open" : ""}`}>
              <button
                aria-label="Close transaction search"
                className="search-backdrop"
                onClick={() => setIsSearchOpen(false)}
                type="button"
              />
              <form
                className="search"
                id="mobile-transaction-search"
                role="search"
                aria-label="Search transactions"
                onSubmit={handleSearchSubmit}
              >
                <Search size={14} aria-hidden />
                <input
                  defaultValue={currentTransactionSearch}
                  key={`${pathname}:${currentTransactionSearch}`}
                  name="q"
                  placeholder="Search transactions, merchants, categories..."
                  ref={searchInputRef}
                  type="search"
                />
                <kbd>Cmd K</kbd>
                <button
                  aria-label="Close search"
                  className="search-close"
                  onClick={() => setIsSearchOpen(false)}
                  type="button"
                >
                  <X size={15} aria-hidden />
                </button>
              </form>
            </div>
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
