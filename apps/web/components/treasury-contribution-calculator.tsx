"use client";

import { useMemo, useState } from "react";
import {
  Calculator,
  Landmark,
  PackageCheck,
  Store,
  Users,
  WalletCards,
} from "lucide-react";

const CONTRIBUTION_RATES = [4, 6, 8, 10, 12, 15];

const INVESTMENT_EXAMPLES = [
  {
    title: "Neighborhood market",
    budget: 300000,
    description: "Open a small food market with refrigeration, first inventory, checkout, permits, and working capital.",
    individual: "nearby staples, member bundles, and more reliable access to everyday goods",
  },
  {
    title: "Local fulfillment route",
    budget: 125000,
    description: "Launch delivery capacity with a cargo van, storage, packing supplies, routing tools, insurance, and early payroll.",
    individual: "cheaper local delivery, more sales channels, and steadier work moving goods",
  },
  {
    title: "Shared production studio",
    budget: 200000,
    description: "Build a bookable workspace with media, printing, fabrication tools, classes, events, and staff support.",
    individual: "affordable workspace, equipment access, classes, and member-run events",
  },
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function TreasuryContributionCalculator() {
  const [monthlySpend, setMonthlySpend] = useState(250);
  const [memberCount, setMemberCount] = useState(5000);
  const [contributionRate, setContributionRate] = useState(10);

  const totals = useMemo(() => {
    const monthlyVolume = monthlySpend * memberCount;
    const monthlyTreasury = monthlyVolume * (contributionRate / 100);
    const annualTreasury = monthlyTreasury * 12;
    const individualMonthlyContribution = monthlySpend * (contributionRate / 100);
    const individualAnnualContribution = individualMonthlyContribution * 12;
    const businessKeepsPerHundred = 100 - contributionRate;
    const governedCapacityPerMember =
      memberCount > 0 ? annualTreasury / memberCount : 0;

    return {
      annualTreasury,
      businessKeepsPerHundred,
      governedCapacityPerMember,
      individualAnnualContribution,
      individualMonthlyContribution,
      monthlyTreasury,
      monthlyVolume,
    };
  }, [contributionRate, memberCount, monthlySpend]);

  const updateMonthlySpend = (value: string) => {
    setMonthlySpend(clampNumber(Number(value), 0, 100000));
  };

  const updateMemberCount = (value: string) => {
    setMemberCount(Math.round(clampNumber(Number(value), 1, 1000000)));
  };

  return (
    <section
      id="treasury-calculator"
      className="border-y border-white/10 bg-[#111111] px-5 py-20 text-white sm:px-6 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/30 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-medium text-[#ffb36f]">
              <Calculator className="h-4 w-4" />
              Treasury calculator
            </div>
            <h2 className="mt-5 text-3xl font-black tracking-tight md:text-5xl">
              See how everyday spending can become community capital.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-400">
              Enter what members spend, choose a community contribution, and see
              the split between business revenue and the treasury members can
              govern together.
            </p>

            <div className="mt-8 space-y-5 rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
              <label className="block">
                <span className="text-sm font-bold text-slate-200">
                  Monthly spend per person
                </span>
                <div className="mt-2 flex items-center rounded-lg border border-white/15 bg-[#111111] px-3 focus-within:border-[#f0975b]/70">
                  <span className="text-slate-500">$</span>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={monthlySpend}
                    onChange={(event) => updateMonthlySpend(event.target.value)}
                    className="h-12 w-full bg-transparent px-2 text-lg font-bold text-white outline-none"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-bold text-slate-200">
                  Number of people
                </span>
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  value={memberCount}
                  onChange={(event) => updateMemberCount(event.target.value)}
                  className="mt-2 h-12 w-full rounded-lg border border-white/15 bg-[#111111] px-3 text-lg font-bold text-white outline-none focus:border-[#f0975b]/70"
                />
              </label>

              <div>
                <p className="text-sm font-bold text-slate-200">
                  Community contribution
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {CONTRIBUTION_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setContributionRate(rate)}
                      className={`min-h-11 rounded-lg border px-2 text-sm font-black transition ${
                        contributionRate === rate
                          ? "border-[#f0975b] bg-[#f0975b] text-[#111111]"
                          : "border-white/15 bg-white/[0.04] text-slate-300 hover:border-[#f0975b]/60 hover:text-white"
                      }`}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
                <div className="flex items-center gap-3 text-[#ffb36f]">
                  <Users className="h-5 w-5" />
                  <p className="text-sm font-bold uppercase tracking-widest">
                    People spend
                  </p>
                </div>
                <p className="mt-4 text-3xl font-black">
                  {formatCurrency(totals.monthlyVolume)}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {formatCurrency(monthlySpend)} per person x{" "}
                  {memberCount.toLocaleString()} people each month.
                </p>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
                <div className="flex items-center gap-3 text-emerald-300">
                  <Store className="h-5 w-5" />
                  <p className="text-sm font-bold uppercase tracking-widest">
                    Business keeps
                  </p>
                </div>
                <p className="mt-4 text-3xl font-black">
                  {formatCurrency(totals.businessKeepsPerHundred)}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  For every $100 spent, the business keeps this amount and{" "}
                  {formatCurrency(contributionRate)} goes to the governed
                  treasury.
                </p>
              </div>

              <div className="rounded-lg border border-[#f0975b]/30 bg-[#f0975b]/10 p-5">
                <div className="flex items-center gap-3 text-[#ffb36f]">
                  <Landmark className="h-5 w-5" />
                  <p className="text-sm font-bold uppercase tracking-widest">
                    Total treasury
                  </p>
                </div>
                <p className="mt-4 text-3xl font-black">
                  {formatCurrency(totals.monthlyTreasury)}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {formatCurrency(totals.individualMonthlyContribution)} per
                  person each month, or{" "}
                  {formatCurrency(totals.individualAnnualContribution)} per
                  person per year.
                </p>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
                <div className="flex items-center gap-3 text-sky-300">
                  <WalletCards className="h-5 w-5" />
                  <p className="text-sm font-bold uppercase tracking-widest">
                    Individual
                  </p>
                </div>
                <p className="mt-4 text-3xl font-black">
                  {formatCurrency(totals.individualMonthlyContribution)}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Monthly contribution per person. That helps govern roughly{" "}
                  {formatCurrency(totals.governedCapacityPerMember)} in annual
                  treasury capacity per member.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest text-[#ffb36f]">
                    Example investments
                  </p>
                  <h3 className="mt-2 text-2xl font-black">
                    What the community could launch
                  </h3>
                </div>
                <p className="max-w-md text-sm leading-6 text-slate-400">
                  Examples use set launch budgets. The goal is to start assets
                  and businesses that become self-sustaining, not dependent on
                  yearly funding.
                </p>
              </div>

              <div className="mt-6 grid gap-3 lg:grid-cols-3">
                {INVESTMENT_EXAMPLES.map((example) => {
                  const budget = example.budget;
                  const individualValue =
                    memberCount > 0 ? budget / memberCount : 0;

                  return (
                    <article
                      key={example.title}
                      className="rounded-lg border border-white/10 bg-[#111111] p-4"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0975b]/15 text-[#ffb36f]">
                        <PackageCheck className="h-5 w-5" />
                      </div>
                      <h4 className="mt-4 text-base font-black">
                        {example.title}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        {example.description}
                      </p>
                      <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-500">Launch budget</span>
                          <span className="font-bold text-white">
                            {formatCurrency(budget)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-500">Member share</span>
                          <span className="font-bold text-[#ffb36f]">
                            {formatCurrency(individualValue)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        Individuals could get {example.individual}.
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
