import { z } from "zod";

import {
  DEFAULT_OFFER_PRICING,
  OFFER_PRICING_LIMITS,
  type OfferPricingSettings,
} from "@repo/validators/marketplace-offers";

import { auditLogEntry } from "../../lib/audit.js";
import type { Db } from "./shared.js";

/**
 * Platform admins adjust the offer pricing rules in the admin pane. Each value
 * is a PlatformConfig row ("offers.<name>"); a missing or out-of-range value
 * falls back to the default, so a bad edit can't make deals lose money.
 */
const KEYS = Object.keys(DEFAULT_OFFER_PRICING) as Array<keyof OfferPricingSettings>;
const configKey = (name: keyof OfferPricingSettings) => `offers.${name}`;

export async function offerPricingSettings(db: Pick<Db, "platformConfig">): Promise<OfferPricingSettings> {
  const rows = await db.platformConfig
    .findMany({ where: { key: { in: KEYS.map(configKey) } } })
    .catch(() => [] as Array<{ key: string; value: string }>);
  const settings = { ...DEFAULT_OFFER_PRICING };
  for (const row of rows) {
    const name = row.key.slice("offers.".length) as keyof OfferPricingSettings;
    const value = Number(row.value);
    const limits = OFFER_PRICING_LIMITS[name];
    if (limits && Number.isInteger(value) && value >= limits.min && value <= limits.max) settings[name] = value;
  }
  return settings;
}

export const offerPricingUpdateSchema = z
  .object(
    Object.fromEntries(
      KEYS.map((name) => [name, z.number().int().min(OFFER_PRICING_LIMITS[name].min).max(OFFER_PRICING_LIMITS[name].max).optional()]),
    ) as Record<keyof OfferPricingSettings, z.ZodOptional<z.ZodNumber>>,
  )
  .strict();

export async function updateOfferPricingSettings(db: Db, actorId: string, raw: z.input<typeof offerPricingUpdateSchema>) {
  const input = offerPricingUpdateSchema.parse(raw);
  const before = await offerPricingSettings(db);
  for (const name of KEYS) {
    const value = input[name];
    if (value === undefined) continue;
    await db.platformConfig.upsert({
      where: { key: configKey(name) },
      create: { key: configKey(name), value: String(value), updatedBy: actorId },
      update: { value: String(value), updatedBy: actorId },
    });
  }
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action: "OFFER_PRICING_UPDATED", resource: "PlatformConfig", resourceId: "offers", metadata: { before, changes: input } }),
  });
  return offerPricingSettings(db);
}
