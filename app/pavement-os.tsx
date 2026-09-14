"use client";

import { useState, useEffect } from "react";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  DollarSign,
  FileText,
  HardHat,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import { DocketDashboard } from "@/components/docket-dashboard";
import { EstimatesQuotes } from "@/components/estimates-quotes";
import { OperationsPage, type NavLabel } from "@/components/operations-workspace";
import { FieldWorkspace } from "@/components/field-workspace";
import { CommercialWorkspace } from "@/components/commercial-workspace";
import { LiveReport, useLiveReport } from "@/components/live-report";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {WorkspaceBrandProvider,useWorkspaceBrand} from '@/components/workspace-brand';
import { JobHub } from '@/components/job-hub';
import { UniversalSearch } from '@/components/universal-search';
import { PreparationWorkspace } from '@/components/preparation-workspace';
import { IMSWorkspace } from '@/components/ims-workspace';

const nav: Array<[NavLabel, LucideIcon]> = [
  ["Today", LayoutDashboard],
  ["Pipeline", BriefcaseBusiness],
  ["Delivery", HardHat],
  ["Commercial", DollarSign],
  ["Compliance", ShieldCheck],
  ["Insights", BarChart3],
  ["Search", ClipboardList],
  ["Admin/Settings", Settings],
];
const moduleShortcuts: Record<NavLabel, NavLabel[]> = {
  Today: ['Overview', 'Field'], Pipeline: ['Preparation', 'Opportunities', 'Tender Review', 'Estimates & Quotes'],
  Delivery: ['Jobs', 'Planning', 'Field', 'Dockets'], Commercial: ['Commercial', 'Variations', 'Claims'],
  Compliance: ['Preparation', 'IMS & Compliance', 'Resources', 'QA & Safety'], Insights: ['Reports'], Search: ['Search'], 'Admin/Settings': ['Settings'],
  Preparation: [], Overview: [], Opportunities: [], 'Tender Review': [], 'Estimates & Quotes': [], Jobs: [], Planning: [], Field: [], Dockets: [], Variations: [], Claims: [], Resources: [], 'QA & Safety': [], Reports: [], Settings: [], 'IMS & Compliance': [],
};

export function PavementOS() {
  return <WorkspaceBrandProvider><WorkspaceShell/></WorkspaceBrandProvider>;
}
function WorkspaceShell() {
  const {brand,userEmail}=useWorkspaceBrand();
  const [active, setActive] = useState<NavLabel>("Overview");
  useEffect(() => {
    const restore = () => { try { const value = decodeURIComponent(window.location.hash.slice(1)); if ((Object.keys(moduleShortcuts) as string[]).includes(value)) setActive(value as NavLabel); else if (!value) setActive('Today'); } catch { /* Ignore malformed external fragments. */ } };
    restore(); window.addEventListener('hashchange', restore);
    return () => window.removeEventListener('hashchange', restore);
  }, []);
  const report = useLiveReport(active);
  const [open, setOpen] = useState(false);
  const navigate = (label: NavLabel) => {
    setActive(label);
    window.scrollTo({top: 0});
    setOpen(false);
  };

  const navigation = <>
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
            <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary"><HardHat className="size-5" /></span><div className="min-w-0"><p className="truncate font-bold" title={brand.productName}>{brand.productName}</p><p className="truncate text-sm text-slate-400" title={brand.companyName}>{brand.companyName}</p></div></div>

          </div>
          <nav aria-label="Application areas" className="space-y-1 p-3">
            {nav.map(([label, Icon]) => <button key={label} aria-current={active === label ? "page" : undefined} onClick={() => navigate(label)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${active === label ? "bg-primary text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><Icon className="size-4" />{label}{label === "Delivery" && <span className="ml-auto rounded bg-white/15 px-1.5 text-[10px]" aria-label="Dockets needing review">{report.error ? "!" : report.summary?.reviewCount ?? "…"}</span>}</button>)}
          </nav>
          <div className="w-full border-t border-white/10 p-4 text-sm text-slate-400">{brand.workspaceName}<br /><span className="text-emerald-400">Company workspace</span></div>
        </>;
  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-900">
      <a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a>
      <nav aria-label="Quick navigation" className="mobile-quick-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-white lg:hidden">{(['Today','Pipeline','Delivery','Compliance'] as NavLabel[]).map(label => <button key={label} onClick={() => navigate(label)} aria-current={active === label ? 'page' : undefined} className={`min-h-14 px-1 text-sm font-medium ${active === label ? 'bg-orange-50 text-orange-800' : 'text-slate-600'}`}>{label}</button>)}<button className="min-h-14 text-sm font-medium" onClick={() => setOpen(true)}>More</button></nav>
      <Toaster position="top-right" richColors />
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 bg-[#101a24] text-white lg:block"><div className="sticky top-0 max-h-dvh overflow-y-auto">{navigation}</div></aside>
        <Sheet open={open} onOpenChange={setOpen}><SheetContent side="left" className="w-[min(90vw,320px)] overflow-y-auto border-0 bg-[#101a24] p-0 text-white"><SheetTitle className="sr-only">Navigation</SheetTitle><SheetDescription className="sr-only">Choose a module</SheetDescription>{navigation}</SheetContent></Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-2 border-b bg-white px-4 sm:px-6">
            <div className="flex min-w-0 items-center"><button className="flex size-11 shrink-0 items-center justify-center lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button><div className="ml-3 min-w-0 lg:ml-0"><p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">{active}</p><p className="truncate text-sm font-medium text-slate-700">{brand.workspaceName} · {new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',month:'long',year:'numeric'}).format(new Date())}</p></div></div>
            <div className="flex items-center gap-3"><span className="hidden max-w-48 truncate text-sm text-slate-500 sm:inline">{userEmail}</span><span className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">{userEmail.slice(0,2).toUpperCase()||'—'}</span></div>
          </header>
          <main id="main-content" className="min-w-0 flex-1 p-3 pb-24 sm:p-6 lg:p-8">
            {moduleShortcuts[active]?.length > 0 && <div className="mb-5 flex min-w-0 gap-2 overflow-x-auto border-b pb-3" aria-label={`${active} modules`}>{moduleShortcuts[active].map(module => <button key={module} onClick={() => navigate(module)} className={`shrink-0 rounded-full border px-3 py-2 text-sm ${active === module ? 'border-orange-600 bg-orange-50 text-orange-800' : 'bg-white text-slate-700'}`}>{module}</button>)}</div>}
            {active === "Preparation" ? <PreparationWorkspace /> : active === "IMS & Compliance" ? <IMSWorkspace onNavigate={label => navigate(label as NavLabel)} /> : active === "Field" ? <FieldWorkspace /> : ["Commercial", "Variations", "Claims"].includes(active) ? <CommercialWorkspace /> : active === "Dockets" ? <DocketDashboard /> : active === "Estimates & Quotes" ? <EstimatesQuotes /> : active === "Overview" || active === "Today" || active === "Insights" ? <LiveReport {...report} overview={active !== 'Insights'} /> : active === "Pipeline" || active === "Tender Review" ? <OperationsPage key="Opportunities" module="Opportunities" onNavigate={navigate} /> : active === "Delivery" ? <JobHub onNavigate={navigate} /> : active === "Compliance" ? <IMSWorkspace onNavigate={label => navigate(label as NavLabel)} /> : active === "Search" ? <UniversalSearch /> : active === "Admin/Settings" ? <OperationsPage key="Settings" module="Settings" onNavigate={navigate} /> : <OperationsPage key={active} module={active} onNavigate={navigate} />}
          </main>
        </div>
      </div>
    </div>
  );
}
