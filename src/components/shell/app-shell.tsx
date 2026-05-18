"use client";

import {
  ClipboardList,
  History,
  Home,
  Inbox,
  Landmark,
  List,
  Repeat,
  RefreshCw,
  Search,
  Settings,
  X,
  type LucideIcon
} from "lucide-react";
import { TallyMark } from "@/components/brand/tally-mark";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

type RouteKey = "dashboard" | "transactions" | "agentInbox" | "review" | "recurring" | "accounts" | "audit" | "settings";

type RouteMeta = {
  eyebrow: string;
  icon: LucideIcon;
  label: string;
  title: string;
};

type OpportunisticSyncReason = "in_progress" | "no_items" | "recently_synced" | "synced";

interface OpportunisticSyncResponse {
  opportunisticSync?: {
    reason: OpportunisticSyncReason;
  };
}

const routeHref: Record<RouteKey, string> = {
  accounts: "/accounts",
  agentInbox: "/agent-inbox",
  audit: "/audit",
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
  audit: {
    eyebrow: "Sanitized change history",
    icon: History,
    label: "Audit",
    title: "Audit history"
  },
  settings: {
    eyebrow: "Workspace and access",
    icon: Settings,
    label: "Settings",
    title: "Settings"
  }
};

const navigation: RouteKey[] = ["dashboard", "transactions", "agentInbox", "review", "recurring", "accounts", "audit", "settings"];
const primaryNavigation: RouteKey[] = ["dashboard", "transactions", "review", "recurring", "accounts", "audit", "settings"];

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
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const shouldRefocusSearchRef = useRef(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [bankDataCheckStatus, setBankDataCheckStatus] = useState<"checking" | "updated" | null>("checking");

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

  const closeSearch = useCallback((options: { refocusTrigger?: boolean } = {}) => {
    setIsSearchOpen(false);

    if (options.refocusTrigger) {
      requestAnimationFrame(() => searchTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;

      event.preventDefault();
      openSearch();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (!isSearchOpen) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      closeSearch({ refocusTrigger: true });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSearch, isSearchOpen]);

  useEffect(() => {
    if (!shouldRefocusSearchRef.current) return;

    shouldRefocusSearchRef.current = false;
    setIsSearchOpen(true);
    focusSearchInput();
  }, [currentTransactionSearch, focusSearchInput, pathname]);

  useEffect(() => {
    let ignore = false;

    fetch("/api/plaid/sync/opportunistic", {
      cache: "no-store",
      method: "POST"
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as OpportunisticSyncResponse;
        if (!response.ok) return null;
        return body.opportunisticSync?.reason ?? null;
      })
      .then((reason) => {
        if (ignore) return;

        if (reason === "synced") {
          setBankDataCheckStatus("updated");
          router.refresh();
          window.setTimeout(() => {
            if (!ignore) setBankDataCheckStatus(null);
          }, 4000);
          return;
        }

        setBankDataCheckStatus(null);
      })
      .catch(() => {
        if (!ignore) setBankDataCheckStatus(null);
      });

    return () => {
      ignore = true;
    };
  }, [router]);

  function submitTransactionSearch(value: string) {
    const query = value.trim();
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

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    submitTransactionSearch(String(formData.get("q") ?? ""));
  }

  function handleSearchInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;

    event.preventDefault();
    submitTransactionSearch(event.currentTarget.value);
  }

  const handleSidebarWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY === 0 || window.matchMedia("(max-width: 900px)").matches) return;

    const sidebar = event.currentTarget as HTMLElement | null;
    const page = pageRef.current;
    if (!sidebar || !page || page.scrollHeight <= page.clientHeight) return;

    const canScrollSidebarUp = sidebar.scrollTop > 0;
    const canScrollSidebarDown = sidebar.scrollTop + sidebar.clientHeight < sidebar.scrollHeight - 1;
    const shouldScrollSidebar = event.deltaY < 0 ? canScrollSidebarUp : canScrollSidebarDown;
    if (shouldScrollSidebar) return;

    event.preventDefault();
    page.scrollBy({ left: event.deltaX, top: event.deltaY });
  }, []);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    sidebar.addEventListener("wheel", handleSidebarWheel, { passive: false });
    return () => sidebar.removeEventListener("wheel", handleSidebarWheel);
  }, [handleSidebarWheel]);

  return (
    <div className="ledger-app">
      <aside className="sidebar" ref={sidebarRef}>
        <Link className="brand" href={routeHref.dashboard} aria-label="Tally dashboard">
          <div className="brand-mark"><TallyMark aria-hidden /></div>
          <div className="brand-name">Tally</div>
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
            {bankDataCheckStatus ? (
              <div className="bank-data-check" role="status">
                <RefreshCw size={13} aria-hidden />
                <span>{bankDataCheckStatus === "checking" ? "Checking for new bank data" : "Bank data updated"}</span>
              </div>
            ) : null}
            <button
              aria-controls="mobile-transaction-search"
              aria-expanded={isSearchOpen}
              aria-label="Open transaction search"
              className="mobile-search-trigger"
              onClick={openSearch}
              ref={searchTriggerRef}
              type="button"
            >
              <Search size={15} aria-hidden />
              <span>Search</span>
            </button>
            <div className={`search-layer ${isSearchOpen ? "search-open" : ""}`}>
              <button
                aria-label="Close transaction search"
                className="search-backdrop"
                onClick={() => closeSearch()}
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
                <label className="sr-only" htmlFor="transaction-global-search">Search transactions</label>
                <input
                  defaultValue={currentTransactionSearch}
                  id="transaction-global-search"
                  key={`${pathname}:${currentTransactionSearch}`}
                  name="q"
                  onKeyDown={handleSearchInputKeyDown}
                  placeholder="Search transactions..."
                  ref={searchInputRef}
                  type="search"
                />
                <kbd>Cmd K</kbd>
                <button
                  aria-label="Close search"
                  className="search-close"
                  onClick={() => closeSearch({ refocusTrigger: true })}
                  type="button"
                >
                  <X size={15} aria-hidden />
                </button>
              </form>
            </div>
          </div>
        </header>
        <div className="page" ref={pageRef}>{children}</div>
      </main>
    </div>
  );
}
