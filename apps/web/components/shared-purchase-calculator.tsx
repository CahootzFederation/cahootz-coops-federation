"use client";

import { useMemo, useState } from "react";
import { HandCoins, ShoppingBasket, Target, UsersRound } from "lucide-react";

import {
  DEFAULT_OFFER_PRICING,
  type OfferPricingSettings,
} from "@repo/validators/marketplace-offers";

import {
  COMMONS_CATALOGS,
  commonsPlanningRateBps,
  type CommonsCatalog,
} from "./group-buy-product-calculator";

export const DEFAULT_GROUP_SIZE = 24;
export const DEFAULT_UNITS_PER_PERSON = 1;
export const DEFAULT_COMMONS_SHARE_BASIS_POINTS = 500;
export const DEFAULT_PURCHASE_AMOUNT_DOLLARS = 100_000;

export interface CommonsGoal {
  id: string;
  name: string;
  description: string;
  targetCents: number;
}

export const EXAMPLE_COMMONS_GOALS: CommonsGoal[] = [
  {
    id: "shared-supplies",
    name: "Shared supplies",
    description: "Build a fund for materials members can use together.",
    targetCents: 10_000,
  },
  {
    id: "community-gathering",
    name: "Community gathering",
    description: "Set money aside for a member-approved event or workshop.",
    targetCents: 25_000,
  },
  {
    id: "member-reserve",
    name: "Member emergency reserve",
    description: "Grow a pool for urgent needs approved by the Commons.",
    targetCents: 100_000,
  },
  {
    id: "commons-venture",
    name: "Commons-owned venture",
    description: "Accumulate early capital for a business members choose.",
    targetCents: 500_000,
  },
];

export interface SharedPurchaseImpactInput {
  purchaseAmountCents: number;
  peopleCount?: number;
  commonsShareBasisPoints?: number;
  goals?: CommonsGoal[];
}

export interface CommonsGoalProjection extends CommonsGoal {
  progressPercent: number;
  ordersNeeded: number | null;
}

export interface SharedPurchaseImpact {
  purchaseAmountCents: number;
  peopleCount: number;
  unitsPerPerson: number;
  perPersonSpendCents: number;
  commonsShareBasisPoints: number;
  commonsShareCents: number;
  goalProjections: CommonsGoalProjection[];
}

export function calculateSharedPurchaseImpact({
  purchaseAmountCents,
  peopleCount = DEFAULT_GROUP_SIZE,
  commonsShareBasisPoints = DEFAULT_COMMONS_SHARE_BASIS_POINTS,
  goals = EXAMPLE_COMMONS_GOALS,
}: SharedPurchaseImpactInput): SharedPurchaseImpact {
  const safePeopleCount = Math.max(1, Math.round(peopleCount));
  const safePurchaseAmountCents = Math.max(0, Math.round(purchaseAmountCents));
  const safeCommonsShareBasisPoints = Math.min(
    10_000,
    Math.max(0, Math.round(commonsShareBasisPoints)),
  );
  const commonsShareCents = Math.round(
    (safePurchaseAmountCents * safeCommonsShareBasisPoints) / 10_000,
  );
  const goalProjections = goals.map((goal) => {
    const safeTargetCents = Math.max(1, Math.round(goal.targetCents));
    const rawProgress = Math.round((commonsShareCents / safeTargetCents) * 100);

    return {
      ...goal,
      targetCents: safeTargetCents,
      progressPercent:
        commonsShareCents > 0 ? Math.min(100, Math.max(1, rawProgress)) : 0,
      ordersNeeded:
        commonsShareCents > 0
          ? Math.ceil(safeTargetCents / commonsShareCents)
          : null,
    };
  });

  return {
    purchaseAmountCents: safePurchaseAmountCents,
    peopleCount: safePeopleCount,
    unitsPerPerson: DEFAULT_UNITS_PER_PERSON,
    perPersonSpendCents: Math.round(safePurchaseAmountCents / safePeopleCount),
    commonsShareBasisPoints: safeCommonsShareBasisPoints,
    commonsShareCents,
    goalProjections,
  };
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(cents: number) {
  return currencyFormatter.format(cents / 100);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The planning rate is the Commons share as a percent of what members pay,
 * averaged over the deals shown above (commonsPlanningRateBps), so this
 * estimate uses the same price rule as real offers. Falls back to 5%.
 */
export function SharedPurchaseCalculator({
  catalogs = COMMONS_CATALOGS,
  pricing = DEFAULT_OFFER_PRICING,
}: {
  catalogs?: CommonsCatalog[];
  pricing?: OfferPricingSettings;
} = {}) {
  const commonsShareBasisPoints = useMemo(
    () => commonsPlanningRateBps(catalogs, pricing) ?? DEFAULT_COMMONS_SHARE_BASIS_POINTS,
    [catalogs, pricing],
  );
  const [purchaseAmount, setPurchaseAmount] = useState(
    DEFAULT_PURCHASE_AMOUNT_DOLLARS,
  );

  const impact = useMemo(
    () =>
      calculateSharedPurchaseImpact({
        purchaseAmountCents: Math.round(purchaseAmount * 100),
        commonsShareBasisPoints,
      }),
    [purchaseAmount, commonsShareBasisPoints],
  );

  const commonsSharePercent = impact.commonsShareBasisPoints / 100;

  return (
    <section
      className="shared-purchase-calculator"
      aria-labelledby="shared-purchase-calculator-title"
      role="region"
    >
      <div className="shared-purchase-calculator__inner">
        <header className="shared-purchase-calculator__intro">
          <h3 id="shared-purchase-calculator-title">
            See what everyday spending can build.
          </h3>
          <p>
            Change one number to estimate what a typical buying circle could add
            to its Commons—and what repeated purchases could help fund.
          </p>
          <div className="shared-purchase-calculator__assumption">
            <UsersRound aria-hidden="true" size={20} />
            <span>
              Assumes {impact.peopleCount} people making one purchase each.
            </span>
          </div>
        </header>

        <div className="shared-purchase-calculator__tool">
          <div className="shared-purchase-calculator__control">
            <label htmlFor="shared-purchase-amount">
              <span>Total amount bought together</span>
              <div className="shared-purchase-calculator__input">
                <ShoppingBasket aria-hidden="true" size={20} />
                <span aria-hidden="true">$</span>
                <input
                  id="shared-purchase-amount"
                  aria-describedby="shared-purchase-amount-help"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1_000_000}
                  step={50}
                  value={purchaseAmount}
                  onChange={(event) =>
                    setPurchaseAmount(
                      clamp(Number(event.target.value), 0, 1_000_000),
                    )
                  }
                />
              </div>
              <small id="shared-purchase-amount-help">
                Total checkout across the whole buying circle.
              </small>
            </label>
            <p>
              That is about{" "}
              <strong>{formatMoney(impact.perPersonSpendCents)}</strong> per
              person in a {impact.peopleCount}-person circle.
            </p>
          </div>

          <div
            className="shared-purchase-calculator__result"
            aria-live="polite"
          >
            <span className="shared-purchase-calculator__result-label">
              <HandCoins aria-hidden="true" size={21} />
              Estimated Commons share
            </span>
            <strong>{formatMoney(impact.commonsShareCents)}</strong>
            <p>
              Using a {commonsSharePercent}% planning rate, the average Commons
              share on the deals above. Live offers show the exact Commons amount
              before anyone commits.
            </p>
          </div>
        </div>

        <div className="shared-purchase-calculator__goals">
          <div className="shared-purchase-calculator__goals-heading">
            <Target aria-hidden="true" size={22} />
            <div>
              <h4>What could the Commons do with it?</h4>
              <p>
                These are example savings targets—not price quotes. Members
                choose and authorize the real goal.
              </p>
            </div>
          </div>
          <ol>
            {impact.goalProjections.map((goal) => {
              const goalFunded = impact.commonsShareCents >= goal.targetCents;

              return (
                <li key={goal.id}>
                  <div className="shared-purchase-calculator__goal-copy">
                    <div>
                      <strong>{goal.name}</strong>
                      <span>
                        {formatMoney(goal.targetCents)} example target
                      </span>
                    </div>
                    <p>{goal.description}</p>
                  </div>
                  <div className="shared-purchase-calculator__goal-progress">
                    <progress
                      aria-label={goal.name + " example goal progress"}
                      max={100}
                      value={goal.progressPercent}
                    />
                    <span>
                      {goalFunded ? (
                        "Covered by this estimate"
                      ) : goal.ordersNeeded ? (
                        <>
                          {goal.progressPercent}% · about{" "}
                          {goal.ordersNeeded.toLocaleString()} purchases this
                          size
                        </>
                      ) : (
                        "Enter a spending amount to estimate progress"
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="shared-purchase-calculator__note">
          Planning estimate only. The product examples above use their actual
          sample price splits. Shipping, tax, supplier terms, and member
          approval still apply to a live offer.
        </p>
      </div>
    </section>
  );
}
