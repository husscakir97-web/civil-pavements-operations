"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  DollarSign,
  HardHat,
  Home,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { DocketDashboard } from "@/components/docket-dashboard";
import { EstimatesQuotes } from "@/components/estimates-quotes";
import { OperationsPage, type NavLabel } from "@/components/operations-workspace";
import { FieldWorkspace } from "@/components/field-workspace";
import { CommercialWorkspace } from "@/components/commercial-workspace";
import { LiveReport, useLiveReport } from "@/components/live-report";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { WorkspaceBrandProvider, useWorkspaceBrand } from "@/components/workspace-brand";
import { JobHub } from "@/components/job-hub";
import { UniversalSearch } from "@/components/universal-search";
import { PreparationWorkspace } from "@/components/preparation-workspace";
import { IMSWorkspace } from "@/components/ims-workspace";

type AppArea =
  | "Home"
  | "Pipeline"
  | "Projects"
  | "Operations"
  | "Commercial"
  | "IMS & HSEQ"
  | "Reports"
  | "Admin"
  | "Search";

type Subview =
  | "Opportunities"
  | "Tenders"
  | "Estimates"
  | "Schedule"
  | "Resources"
  | "Dockets"
  | "Field"
  | "Company Library"
  | "Settings";

const primaryNav: Array<[Exclude<AppArea, "Search">, LucideIcon]> = [
  ["Home", Home],
  ["Pipeline", BriefcaseBusiness],
  ["Projects", HardHat],
  ["Operations", Workflow],
  ["Commercial", DollarSign],
  ["IMS & HSEQ", ShieldCheck],
  ["Reports", BarChart3],
  ["Admin", Settings],
];

const subviews: Partial<Record<AppArea, Subview[]>> = {
  Pipeline: ["Opportunities", "Tenders", "Estimates"],
  Operations: ["Schedule", "Resources", "Dockets"],
  Admin: ["Company Library", "Settings"],
};

const defaults: Partial<Record<AppArea, Subview>> = {
  Pipeline: "Opportunities",
  Operations: "Schedule",
  Admin: "Company Library",
};

function parseHash(): { area: AppArea; subview?: Subview } {
  if (typeof window === "undefined") return { area: "Home" };
  const raw = decodeURIComponent(window.location.hash.slice(1));
  if (!raw) return { area: "Home" };
  const [areaRaw, subviewRaw] = raw.split("/");
  const allAreas: AppArea[] = ["Home", "Pipeline", "Projects", "Operations", "Commercial", "IMS & HSEQ", "Reports", "Admin", "Search"];
  const area = allAreas.includes(areaRaw as AppArea) ? (areaRaw as AppArea) : "Home";
  const allowed = subviews[area] ?? [];
  const subview = allowed.includes(subviewRaw as Subview) ? (subviewRaw as Subview) : defaults[area];
  return { area, subview };
}

export function PavementOS() {
  return (
    <WorkspaceBrandProvider>
      <WorkspaceShell />
    </WorkspaceBrandProvider>
  );
}

function WorkspaceShell() {
  const { brand, userEmail } = useWorkspaceBrand();
  const initial = useMemo(() => ({ area: "Home" as AppArea, subview: undefined as Subview | undefined }), []);
  const [area, setArea] = useState<AppArea>(initial.area);
  const [subview, setSubview] = useState<Subview | undefined>(initial.subview);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const restore = () => {
      try {
        const next = parseHash();
        setArea(next.area);
        setSubview(next.subview);
      } catch {
        setArea("Home");
        setSubview(undefined);
      }
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);

  const report = useLiveReport(area === "Reports" ? "Reports" : "Overview");

  function navigate(nextArea: AppArea, nextSubview?: Subview) {
    const resolvedSubview = nextSubview ?? defaults[nextArea];
    setArea(nextArea);
    setSubview(resolvedSubview);
    const hash = resolvedSubview ? `${nextArea}/${resolvedSubview}` : nextArea;
    if (window.location.hash.slice(1) !== encodeURIComponent(hash)) {
      window.history.replaceState(null, "", `#${encodeURIComponent(hash)}`);
    }
    window.scrollTo({ top: 0 });
    setOpen(false);
  }

  function navigateLegacy(label: NavLabel) {
    const map: Partial<Record<NavLabel, [AppArea, Subview?]>> = {
      Today: ["Home"],
      Overview: ["Home"],
      Pipeline: ["Pipeline", "Opportunities"],
      Opportunities: ["Pipeline", "Opportunities"],
      "Tender Review": ["Pipeline", "Tenders"],
      "Estimates & Quotes": ["Pipeline", "Estimates"],
      Delivery: ["Projects"],
      Jobs: ["Projects"],
      Planning: ["Operations", "Schedule"],
      Resources: ["Operations", "Resources"],
      Dockets: ["Operations", "Dockets"],
      Field: ["Operations", "Field"],
      Commercial: ["Commercial"],
      Variations: ["Commercial"],
      Claims: ["Commercial"],
      Compliance: ["IMS & HSEQ"],
      "IMS & Compliance": ["IMS & HSEQ"],
      "QA & Safety": ["IMS & HSEQ"],
      Insights: ["Reports"],
      Reports: ["Reports"],
      Search: ["Search"],
      Preparation: ["Admin", "Company Library"],
      "Admin/Settings": ["Admin", "Settings"],
      Settings: ["Admin", "Settings"],
    };
    const next = map[label] ?? ["Home"];
    navigate(next[0], next[1]);
  }

  const navigation = (
    <>
      <div className="flex h-16 items-center border-b border-white/10 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold" title={brand.productName}>{brand.productName}</p>
            <p className="truncate text-sm text-slate-400" title={brand.companyName}>{brand.companyName}</p>
          </div>
        </div>
      </div>
      <nav aria-label="Primary application areas" className="space-y-1 p-3">
        {primaryNav.map(([label, Icon]) => (
          <button
            key={label}
            aria-current={area === label ? "page" : undefined}
            onClick={() => navigate(label)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${area === label ? "bg-primary text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
          >
            <Icon className="size-4" />
            {label}
            {label === "Operations" && (
              <span className="ml-auto rounded bg-white/15 px-1.5 text-[10px]" aria-label="Dockets needing review">
                {report.error ? "!" : report.summary?.reviewCount ?? "…"}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button onClick={() => navigate("Search")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white">
          <Search className="size-4" /> Global search
        </button>
      </div>
      <div className="w-full border-t border-white/10 p-4 text-sm text-slate-400">
        {brand.workspaceName}<br />
        <span className="text-emerald-400">Company workspace</span>
      </div>
    </>
  );

  const areaSubviews = subviews[area] ?? [];
  const activeSubview = subview ?? defaults[area];

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-900">
      <a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a>
      <nav aria-label="Quick navigation" className="mobile-quick-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white lg:hidden">
        {(["Home", "Pipeline", "Projects", "Operations"] as AppArea[]).map(label => (
          <button key={label} onClick={() => navigate(label)} aria-current={area === label ? "page" : undefined} className={`min-h-14 px-1 text-xs font-medium sm:text-sm ${area === label ? "bg-orange-50 text-orange-800" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
        <button className="min-h-14 text-sm font-medium" onClick={() => setOpen(true)}>More</button>
      </nav>

      <Toaster position="top-right" richColors />
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 bg-[#101a24] text-white lg:block">
          <div className="sticky top-0 max-h-dvh overflow-y-auto">{navigation}</div>
        </aside>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-[min(90vw,320px)] overflow-y-auto border-0 bg-[#101a24] p-0 text-white">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Choose a work area</SheetDescription>
            {navigation}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-2 border-b bg-white px-4 sm:px-6">
            <div className="flex min-w-0 items-center">
              <button className="flex size-11 shrink-0 items-center justify-center lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button>
              <div className="ml-3 min-w-0 lg:ml-0">
                <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {area}{activeSubview ? ` > ${activeSubview}` : ""}
                </p>
                <p className="truncate text-sm font-medium text-slate-700">
                  {brand.workspaceName} · {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", month: "long", year: "numeric" }).format(new Date())}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate("Search")} className="flex size-10 items-center justify-center rounded-lg border bg-white text-slate-600 hover:bg-slate-50" aria-label="Global search"><Search className="size-4" /></button>
              <span className="hidden max-w-48 truncate text-sm text-slate-500 sm:inline">{userEmail}</span>
              <span className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">{userEmail.slice(0, 2).toUpperCase() || "—"}</span>
            </div>
          </header>

          <main id="main-content" className="min-w-0 flex-1 p-3 pb-24 sm:p-6 lg:p-8">
            {areaSubviews.length > 0 && (
              <nav aria-label={`${area} workspace sections`} className="mb-5 flex min-w-0 gap-2 overflow-x-auto border-b pb-3">
                {areaSubviews.map(item => (
                  <button key={item} onClick={() => navigate(area, item)} className={`shrink-0 rounded-full border px-3 py-2 text-sm ${activeSubview === item ? "border-orange-600 bg-orange-50 text-orange-800" : "bg-white text-slate-700"}`}>
                    {item}
                  </button>
                ))}
              </nav>
            )}

            {area === "Home" && <LiveReport {...report} overview />}
            {area === "Pipeline" && activeSubview === "Opportunities" && <OperationsPage key="pipeline-opportunities" module="Opportunities" onNavigate={navigateLegacy} />}
            {area === "Pipeline" && activeSubview === "Tenders" && (
              <div className="space-y-4">
                <section className="rounded-xl border bg-white p-4">
                  <p className="text-sm font-medium text-slate-500">Tender workspace</p>
                  <h1 className="text-2xl font-bold">Tenders</h1>
                  <p className="mt-1 text-sm text-slate-600">Select an opportunity below to open its tender documents, source-linked findings and tender review workflow. This reuses the existing tender engine while keeping tender work inside Pipeline.</p>
                </section>
                <OperationsPage key="pipeline-tenders" module="Opportunities" onNavigate={navigateLegacy} />
              </div>
            )}
            {area === "Pipeline" && activeSubview === "Estimates" && <EstimatesQuotes />}
            {area === "Projects" && <JobHub onNavigate={navigateLegacy} />}
            {area === "Operations" && activeSubview === "Schedule" && <OperationsPage key="operations-schedule" module="Planning" onNavigate={navigateLegacy} />}
            {area === "Operations" && activeSubview === "Resources" && <OperationsPage key="operations-resources" module="Resources" onNavigate={navigateLegacy} />}
            {area === "Operations" && activeSubview === "Dockets" && <DocketDashboard />}
            {area === "Operations" && activeSubview === "Field" && <FieldWorkspace />}
            {area === "Commercial" && <CommercialWorkspace />}
            {area === "IMS & HSEQ" && <IMSWorkspace onNavigate={label => navigateLegacy(label as NavLabel)} />}
            {area === "Reports" && <LiveReport {...report} overview={false} />}
            {area === "Admin" && activeSubview === "Company Library" && <PreparationWorkspace />}
            {area === "Admin" && activeSubview === "Settings" && <OperationsPage key="admin-settings" module="Settings" onNavigate={navigateLegacy} />}
            {area === "Search" && <UniversalSearch />}
          </main>
        </div>
      </div>
    </div>
  );
}
