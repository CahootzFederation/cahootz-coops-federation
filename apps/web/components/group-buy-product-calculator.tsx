"use client";

import type { KeyboardEvent } from "react";
import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, ImageOff, UsersRound } from "lucide-react";

import {
  DEFAULT_OFFER_PRICING,
  suggestItemOfferPrice,
  type OfferPricingSettings,
} from "@repo/validators/marketplace-offers";

export interface CommonsProduct {
  id: string;
  name: string;
  category: string;
  brand: string;
  imageUrl: string;
  imageAlt: string;
  productUrl: string;
  comparisonUrl?: string;
  memberShare: string;
  peopleNeeded: number;
  regularPriceCents: number;
  bulkShareCents: number;
  purpose: string;
  tone: "pear" | "sky" | "mint" | "coral" | "lavender";
}

export interface CommonsCatalog {
  id: string;
  name: string;
  description: string;
  participantLabel: string;
  fundingExamples?: string[];
  products: CommonsProduct[];
}

/**
 * One member's payment, by the same rule as every real offer: the vendor gets
 * the bulk price, Stripe's card fee comes out, and what's left is split between
 * the Commons and Cahootz. Cheap items come in packs so one payment is big
 * enough for the card fee. All amounts are for one pack.
 */
export interface ProductSplit {
  packSize: number;
  regularPriceCents: number;
  vendorCents: number;
  stripeFeeCents: number;
  commonsCutCents: number;
  cahootzCutCents: number;
  memberSavingsCents: number;
  memberPriceCents: number;
  /** Households needed when each buys one pack. */
  membersNeeded: number;
}

const COMMONS_FUNDING_EXAMPLES: Record<string, string[]> = {
  planet: [
    "local cleanup supplies",
    "a repair-and-reuse workshop",
    "seed money for a Commons-owned refill shop",
  ],
  traveler: [
    "shared trip-safety supplies",
    "an emergency travel reserve",
    "seed money for a member-run travel service",
  ],
  family: [
    "school and meal supplies",
    "a family emergency reserve",
    "seed money for a family-owned business",
  ],
  "blues-of-america": [
    "civic education materials",
    "mutual-aid supplies",
    "seed money for a member-owned business",
  ],
};

const DEFAULT_COMMONS_FUNDING_EXAMPLES = [
  "shared supplies",
  "a member-approved project",
  "seed money for a Commons-owned business",
];

export const PLANET_BUY_PRODUCTS: CommonsProduct[] = [
  {
    id: "laundry-pods",
    name: "Laundry pods",
    category: "Laundry",
    brand: "Dropps",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0268/4219/files/Dropps_64ctHero_FreeClear_Unscented.png?v=1762457052",
    imageAlt: "Dropps Free + Clear laundry pods in a 64-count box",
    productUrl: "https://www.dropps.com/products/laundry-pods-bulk",
    memberShare: "64 pods",
    peopleNeeded: 12,
    regularPriceCents: 2889,
    bulkShareCents: 1217,
    purpose: "Plastic-free packaging and a product households buy repeatedly.",
    tone: "pear",
  },
  {
    id: "organic-coffee",
    name: "Organic Fair Trade coffee",
    category: "Pantry",
    brand: "Jo Coffee",
    imageUrl: "https://m.media-amazon.com/images/I/81ZQntx5zAL._SL1500_.jpg",
    imageAlt: "Jo Coffee Colombia Jo organic Fair Trade coffee bag",
    productUrl: "https://www.jocoffee.com/wholesale-ordering.html",
    memberShare: "12 oz bag",
    peopleNeeded: 36,
    regularPriceCents: 1199,
    bulkShareCents: 694,
    purpose: "USDA Organic and Fair Trade coffee bought as six six-bag cases.",
    tone: "coral",
  },
  {
    id: "countertop-bags",
    name: "Countertop compost bags",
    category: "Composting",
    brand: "EcoSafe",
    imageUrl:
      "https://depot.wastecontrolservices.com/cdn/shop/files/CP1617_individualbox.jpg?v=1752519980&width=1445",
    imageAlt: "EcoSafe compostable countertop bags box",
    productUrl:
      "https://greenpaperproducts.com/products/compostable-trash-bags-kitchen-g100",
    memberShare: "60 bags",
    peopleNeeded: 12,
    regularPriceCents: 2354,
    bulkShareCents: 949,
    purpose: "Certified compostable liners for participating compost programs.",
    tone: "mint",
  },
  {
    id: "shampoo-bar",
    name: "Solid shampoo bar",
    category: "Hair care",
    brand: "SOAPY",
    imageUrl:
      "https://www.mysoapy.com/wp-content/uploads/2025/02/shampoo-bars-variation-bulk-400x400.png",
    imageAlt: "Assorted SOAPY solid shampoo bars in a wholesale pack",
    productUrl:
      "https://www.mysoapy.com/product/wholesale-solid-shampoo-bars-re-seller-10-pack/",
    memberShare: "1 bar",
    peopleNeeded: 10,
    regularPriceCents: 1000,
    bulkShareCents: 700,
    purpose:
      "A concentrated hair-care bar sold in a low-commitment ten-bar reseller pack.",
    tone: "lavender",
  },
  {
    id: "paper-towels",
    name: "Recycled paper towels",
    category: "Paper goods",
    brand: "Who Gives A Crap",
    imageUrl:
      "https://ca.whogivesacrap.org/cdn/shop/files/12pk_e4dc2afb-615e-4bac-b4a0-07ba943d30e5.jpg?v=1781079508&width=957",
    imageAlt: "Box of twelve Who Gives A Crap recycled paper towel rolls",
    productUrl:
      "https://us.wholesale.whogivesacrap.org/products/recycled-paper-towels-12-rolls",
    memberShare: "12 rolls",
    peopleNeeded: 13,
    regularPriceCents: 3900,
    bulkShareCents: 2730,
    purpose: "Paper towels made from recycled paper rather than virgin trees.",
    tone: "lavender",
  },
  {
    id: "vegan-soap",
    name: "Vegan soap bar",
    category: "Bath",
    brand: "Hippotanicals",
    imageUrl:
      "https://www.hippotanicals.com/cdn/shop/files/HerbalRefreshSoapTrio_1024x1024.png?v=1738559393",
    imageAlt: "Three packaged Hippotanicals plant-based soap bars",
    productUrl:
      "https://www.hippotanicals.com/products/vegan-soap-bars-case-of-6",
    memberShare: "1 bar",
    peopleNeeded: 6,
    regularPriceCents: 800,
    bulkShareCents: 430,
    purpose: "A vegan, palm-oil-free everyday soap sold in a six-bar case.",
    tone: "mint",
  },
  {
    id: "dryer-balls",
    name: "Wool dryer balls",
    category: "Reusable home",
    brand: "Bulk Apothecary",
    imageUrl:
      "https://cdn11.bigcommerce.com/s-99si0d/images/stencil/400x400/products/9176/53959/wool_dryer_balls_1__81251.1760725246.jpg?c=2",
    imageAlt: "Six wool dryer balls with a cotton storage bag",
    productUrl: "https://www.bulkapothecary.com/wool-dryer-balls-6-pack/",
    memberShare: "6 balls",
    peopleNeeded: 55,
    regularPriceCents: 1490,
    bulkShareCents: 1000,
    purpose:
      "A reusable alternative to disposable dryer sheets, sold by the case.",
    tone: "sky",
  },
  {
    id: "toilet-paper",
    name: "Recycled toilet paper",
    category: "Paper goods",
    brand: "Who Gives A Crap",
    imageUrl:
      "https://missv.com.au/wp-content/uploads/2020/05/WGAC_ProductPhotos_2018Packaging_TransparentBG_DL48Pack_1024x1024.png",
    imageAlt: "Box of individually wrapped recycled toilet paper rolls",
    productUrl:
      "https://us.wholesale.whogivesacrap.org/products/100-recycled-toilet-paper-48-super-long-rolls-copy",
    memberShare: "12 rolls",
    peopleNeeded: 32,
    regularPriceCents: 1700,
    bulkShareCents: 1190,
    purpose: "A recurring household essential made from recycled paper.",
    tone: "sky",
  },
];

export const TRAVELER_COMMONS_PRODUCTS: CommonsProduct[] = [
  {
    id: "travel-laundry-bags",
    name: "Travel laundry bags",
    category: "Organization",
    brand: "DollarDays",
    imageUrl:
      "https://dm61q01mhxuli.cloudfront.net/images/r56/image2/042125102128112.jpg",
    imageAlt: "Three assorted drawstring travel laundry bags",
    productUrl:
      "https://www.dollardays.com/i2384895-wholesale-travel-laundry-bags-3-pack-assorted-colors.html",
    comparisonUrl:
      "https://www.relymedia.com/single-products/travel-laundry-bags-3-pack-assorted-colors-219043",
    memberShare: "1 carded 3-pack",
    peopleNeeded: 48,
    regularPriceCents: 243,
    bulkShareCents: 143,
    purpose:
      "A compact way to separate clean and worn clothes, supplied in a 48-unit case.",
    tone: "lavender",
  },
  {
    id: "travel-toothbrush",
    name: "Travel toothbrush",
    category: "Toiletries",
    brand: "Unbranded",
    imageUrl:
      "https://dm61q01mhxuli.cloudfront.net/images/n25/image2/tbtravel100.jpg",
    imageAlt: "Blue and white two-piece travel toothbrush",
    productUrl:
      "https://www.dollardays.com/i2133266-wholesale-travel-toothbrush-2-piece-100-count.html",
    comparisonUrl: "https://www.4allpromos.com/taxonomy/term/742",
    memberShare: "1 toothbrush",
    peopleNeeded: 100,
    regularPriceCents: 142,
    bulkShareCents: 57,
    purpose:
      "An individually wrapped two-piece toothbrush supplied in a 100-unit case.",
    tone: "sky",
  },
  {
    id: "personal-alarm",
    name: "Personal safety alarm",
    category: "Travel safety",
    brand: "Mayday",
    imageUrl:
      "https://dm61q01mhxuli.cloudfront.net/images/d27/image2/122225023801987.jpg",
    imageAlt: "Assorted mini emergency alarm keychains with LED lights",
    productUrl:
      "https://www.dollardays.com/i2389433-wholesale-mini-emergency-alarm-keychain-assorted.html",
    comparisonUrl:
      "https://americanbusneo.com/p/product/dce9f902-577a-41ac-a138-1d85e123edd3/mini-emergency-alarm-keychain-assorted",
    memberShare: "1 alarm",
    peopleNeeded: 24,
    regularPriceCents: 928,
    bulkShareCents: 546,
    purpose:
      "A 100-decibel keychain alarm with an LED light, supplied in a 24-unit case.",
    tone: "coral",
  },
  {
    id: "water-fan",
    name: "Rechargeable misting fan",
    category: "Warm-weather travel",
    brand: "Modern Monkey",
    imageUrl:
      "https://dm61q01mhxuli.cloudfront.net/images/d27/image2/060524102709620.jpg",
    imageAlt: "Assorted handheld rechargeable fans with refillable water tanks",
    productUrl:
      "https://www.dollardays.com/i2377336-wholesale-2-in-1-rechargeable-water-fans-assorted.html",
    comparisonUrl:
      "https://www.staples.com/Modern-Monkey-Handheld-General-Purpose-Fans/cat_CL80002/fcge8-p9t0b",
    memberShare: "1 fan",
    peopleNeeded: 24,
    regularPriceCents: 1699,
    bulkShareCents: 1096,
    purpose:
      "A USB-C rechargeable hand fan with four speeds and a refillable misting tank.",
    tone: "mint",
  },
];

const familySharedProductIds = new Set(["laundry-pods", "toilet-paper"]);

const FAMILY_ONLY_PRODUCTS: CommonsProduct[] = [
  {
    id: "bluey-lunch-bag",
    name: "Insulated kids lunch bag",
    category: "School lunch",
    brand: "Bluey",
    imageUrl: "https://www.4sgm.com/assets/Image/Product/detailsbig/83901.jpg",
    imageAlt: "Bluey insulated children's lunch bag",
    productUrl:
      "https://www.4sgm.com/product/83901/Bluey-Insulated-Lunch-Box.html?language=en",
    memberShare: "1 insulated bag",
    peopleNeeded: 120,
    regularPriceCents: 530,
    bulkShareCents: 450,
    purpose:
      "A school-day essential with published volume pricing for ten cases.",
    tone: "sky",
  },
  {
    id: "family-food-containers",
    name: "30-piece food container set",
    category: "Meal prep",
    brand: "4SGM",
    imageUrl: "https://www.4sgm.com/assets/Image/Product/detailsbig/36176.jpg",
    imageAlt: "Thirty-piece reusable food container set with blue lids",
    productUrl:
      "https://www.4sgm.com/product/36176/Plastic-Food-Containers,-30-Piece-Set,-Reusable,-Blue-Lid,-BPA-Free.html?language=en",
    memberShare: "1 thirty-piece set",
    peopleNeeded: 6,
    regularPriceCents: 625,
    bulkShareCents: 525,
    purpose:
      "Reusable, stackable containers for leftovers, lunches, and family meal prep.",
    tone: "mint",
  },
];

export const FAMILY_COMMONS_PRODUCTS = [
  ...FAMILY_ONLY_PRODUCTS,
  ...PLANET_BUY_PRODUCTS.filter(({ id }) => familySharedProductIds.has(id)),
];

const bluesProductPurposes: Record<string, string> = {
  "organic-coffee":
    "A Fair Trade pantry staple that connects repeat spending to better labor standards.",
  "paper-towels":
    "A recycled household staple for members prioritizing climate-conscious purchasing.",
};

const BLUES_ONLY_PRODUCTS: CommonsProduct[] = [
  {
    id: "union-printed-tote",
    name: "Union-printed reusable tote",
    category: "Fair labor",
    brand: "Cameo Line",
    imageUrl:
      "https://storage.googleapis.com/live-server/items/1567/17182-003.jpg",
    imageAlt: "Union-shop printed reusable tote bag",
    productUrl: "https://www.cameoline.com/details/tote-bags/2-003",
    memberShare: "1 printed tote",
    peopleNeeded: 150,
    regularPriceCents: 235,
    bulkShareCents: 191,
    purpose:
      "A reusable tote decorated in a union shop, with the union bug available.",
    tone: "sky",
  },
  {
    id: "fair-trade-chocolate",
    name: "Fair Trade chocolate bar",
    category: "Worker-owned supply chain",
    brand: "Divine Chocolate",
    imageUrl:
      "https://www.divinechocolateusa.com/cdn/shop/files/div-004623-60_-dark-chocolate-with-toffee-sea-salt_1.png?v=1786051511&width=1080",
    imageAlt: "Divine Fair Trade dark chocolate with toffee and sea salt",
    productUrl:
      "https://www.serrv.org/60-dark-with-toffee-sea-salt-large-bar-case/",
    comparisonUrl:
      "https://www.divinechocolateusa.com/collections/dark-chocolate/products/60-dark-chocolate-with-toffee-sea-salt-sharing-bar-3-oz",
    memberShare: "1 three-ounce bar",
    peopleNeeded: 12,
    regularPriceCents: 729,
    bulkShareCents: 542,
    purpose:
      "Farmer-owned Fair Trade chocolate whose premiums support cocoa-growing communities.",
    tone: "coral",
  },
];

export const BLUES_OF_AMERICA_PRODUCTS = [
  ...BLUES_ONLY_PRODUCTS,
  ...PLANET_BUY_PRODUCTS.filter(({ id }) => id in bluesProductPurposes).map(
    (product) => ({
      ...product,
      purpose: bluesProductPurposes[product.id] ?? product.purpose,
    }),
  ),
];

export const COMMONS_CATALOGS: CommonsCatalog[] = [
  {
    id: "planet",
    name: "Planet Commons",
    description:
      "Lower-waste, reusable, compostable, and responsibly made essentials for people protecting the planet.",
    participantLabel: "households",
    fundingExamples: COMMONS_FUNDING_EXAMPLES.planet,
    products: PLANET_BUY_PRODUCTS,
  },
  {
    id: "traveler",
    name: "Traveler Commons",
    description:
      "Useful trip essentials that frequent travelers can order by the case and divide among members.",
    participantLabel: "travelers",
    fundingExamples: COMMONS_FUNDING_EXAMPLES.traveler,
    products: TRAVELER_COMMONS_PRODUCTS,
  },
  {
    id: "family",
    name: "Family Commons",
    description:
      "Repeat household staples that families can plan for, purchase together, and keep stocked.",
    participantLabel: "households",
    fundingExamples: COMMONS_FUNDING_EXAMPLES.family,
    products: FAMILY_COMMONS_PRODUCTS,
  },
  {
    id: "blues-of-america",
    name: "Blues of America",
    description:
      "Everyday products selected around fair labor, climate responsibility, and shared community benefit.",
    participantLabel: "members",
    fundingExamples: COMMONS_FUNDING_EXAMPLES["blues-of-america"],
    products: BLUES_OF_AMERICA_PRODUCTS,
  },
];

export function calculateProductSplit(
  product: Pick<CommonsProduct, "regularPriceCents" | "bulkShareCents"> &
    Partial<Pick<CommonsProduct, "peopleNeeded">>,
  pricing: OfferPricingSettings = DEFAULT_OFFER_PRICING,
): ProductSplit {
  const suggestion = suggestItemOfferPrice({
    regularPriceCents: product.regularPriceCents,
    bulkPriceCents: product.bulkShareCents,
    pricing,
  });
  const packSize = suggestion?.packSize ?? 1;
  const membersNeeded = Math.max(
    2,
    Math.ceil((product.peopleNeeded ?? 2) / packSize),
  );
  if (!suggestion) {
    // No real discount: members would just pay the regular price.
    return {
      packSize,
      regularPriceCents: product.regularPriceCents,
      vendorCents: product.regularPriceCents,
      stripeFeeCents: 0,
      commonsCutCents: 0,
      cahootzCutCents: 0,
      memberSavingsCents: 0,
      memberPriceCents: product.regularPriceCents,
      membersNeeded,
    };
  }
  return {
    packSize,
    regularPriceCents: suggestion.regularPriceCents,
    vendorCents: suggestion.vendorPayoutCents,
    stripeFeeCents: suggestion.stripeFeeCents,
    commonsCutCents: suggestion.commonsCents,
    cahootzCutCents: suggestion.cahootzCents,
    memberSavingsCents: suggestion.savingsCents,
    memberPriceCents: suggestion.memberPriceCents,
    membersNeeded,
  };
}

/**
 * The Commons share as a percent of what members pay, averaged over the shown
 * products, in basis points. The funding estimate below the catalog uses it.
 */
export function commonsPlanningRateBps(
  catalogs: CommonsCatalog[],
  pricing: OfferPricingSettings = DEFAULT_OFFER_PRICING,
): number | null {
  const rates = catalogs
    .flatMap((catalog) => catalog.products)
    .map((product) => calculateProductSplit(product, pricing))
    .filter((split) => split.memberPriceCents > 0 && split.commonsCutCents > 0)
    .map((split) => split.commonsCutCents / split.memberPriceCents);
  if (rates.length === 0) return null;
  return Math.round(
    (rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 10000,
  );
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function formatFundingExamples(examples: string[]): string {
  if (examples.length === 0) return "a member-approved priority";
  if (examples.length === 1) return examples[0] ?? "a member-approved priority";
  if (examples.length === 2) return `${examples[0]} or ${examples[1]}`;

  return `${examples.slice(0, -1).join(", ")}, or ${examples[examples.length - 1]}`;
}

export function GroupBuyProductCalculator({
  catalogs = COMMONS_CATALOGS,
  pricing = DEFAULT_OFFER_PRICING,
}: {
  catalogs?: CommonsCatalog[];
  pricing?: OfferPricingSettings;
}) {
  const activeCatalogs = catalogs.length > 0 ? catalogs : COMMONS_CATALOGS;
  const [selectedCommonsId, setSelectedCommonsId] = useState<
    CommonsCatalog["id"]
  >(activeCatalogs[0]?.id ?? "planet");
  const [selectedProductIds, setSelectedProductIds] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      activeCatalogs.map((catalog) => [
        catalog.id,
        catalog.products[0]?.id ?? "",
      ]),
    ),
  );
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const commonsTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedCommons =
    activeCatalogs.find(({ id }) => id === selectedCommonsId) ??
    activeCatalogs[0];

  const selectedProductId = selectedCommons
    ? selectedProductIds[selectedCommons.id]
    : "";

  const selectedProduct =
    selectedCommons?.products.find(({ id }) => id === selectedProductId) ??
    selectedCommons?.products[0];

  const split = useMemo(
    () =>
      selectedProduct
        ? calculateProductSplit(selectedProduct, pricing)
        : calculateProductSplit(
            { regularPriceCents: 0, bulkShareCents: 0 },
            pricing,
          ),
    [selectedProduct, pricing],
  );

  if (!selectedCommons || !selectedProduct) return null;

  const memberDiscountPercent =
    split.regularPriceCents > 0
      ? Math.floor((split.memberSavingsCents / split.regularPriceCents) * 100)
      : 0;
  const groupCommonsTotalCents = split.commonsCutCents * split.membersNeeded;
  const packLabel =
    split.packSize > 1
      ? `${split.packSize} × ${selectedProduct.memberShare}`
      : selectedProduct.memberShare;
  const fundingExamples =
    selectedCommons.fundingExamples?.length > 0
      ? selectedCommons.fundingExamples
      : (COMMONS_FUNDING_EXAMPLES[selectedCommons.id] ??
        DEFAULT_COMMONS_FUNDING_EXAMPLES);

  const selectProduct = (productId: string) => {
    setSelectedProductIds((current) => ({
      ...current,
      [selectedCommons.id]: productId,
    }));
  };

  const markImageFailed = (imageKey: string) => {
    setFailedImages((current) => new Set(current).add(imageKey));
  };

  const handleCommonsKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const lastIndex = activeCatalogs.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % activeCatalogs.length
            : (currentIndex - 1 + activeCatalogs.length) %
              activeCatalogs.length;
    const nextCommons = activeCatalogs[nextIndex];

    if (!nextCommons) return;
    setSelectedCommonsId(nextCommons.id);
    commonsTabRefs.current[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <div
      className="planet-deal-tool"
      role="region"
      aria-label="Commons shared-price calculator"
    >
      <div className="commons-catalog-switch">
        <div className="commons-catalog-switch__heading">
          <p>Browse by Commons</p>
          <span>Each Commons can organize around a different shared need.</span>
        </div>
        <div
          className="commons-catalog-switch__tabs"
          role="tablist"
          aria-label="Choose a Commons catalog"
        >
          {activeCatalogs.map((catalog, index) => {
            const isSelected = catalog.id === selectedCommons.id;

            return (
              <button
                className="commons-catalog-switch__tab"
                type="button"
                role="tab"
                id={`commons-tab-${catalog.id}`}
                aria-controls="commons-catalog-panel"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                key={catalog.id}
                ref={(node) => {
                  commonsTabRefs.current[index] = node;
                }}
                onClick={() => setSelectedCommonsId(catalog.id)}
                onKeyDown={(event) => handleCommonsKeyDown(event, index)}
              >
                {catalog.name}
              </button>
            );
          })}
        </div>
        <p className="commons-catalog-switch__description" aria-live="polite">
          <strong>{selectedCommons.name}</strong>
          {selectedCommons.description}
        </p>
      </div>

      <div
        className="commons-catalog-panel"
        role="tabpanel"
        id="commons-catalog-panel"
        aria-labelledby={`commons-tab-${selectedCommons.id}`}
      >
        <fieldset className="planet-products">
          <legend className="sr-only">
            Choose a product for {selectedCommons.name}
          </legend>
          {selectedCommons.products.map((product) => {
            const isSelected = product.id === selectedProduct.id;
            const imageKey = `${selectedCommons.id}:${product.id}`;

            return (
              <label
                className={`planet-product-card planet-product-card--${product.tone}`}
                key={product.id}
              >
                <input
                  type="radio"
                  name={`commons-product-${selectedCommons.id}`}
                  value={product.id}
                  checked={isSelected}
                  onChange={() => selectProduct(product.id)}
                />
                <span className="planet-product-card__image">
                  {failedImages.has(imageKey) ? (
                    <span className="planet-product-card__fallback">
                      <ImageOff aria-hidden="true" size={24} />
                      Product image
                    </span>
                  ) : (
                    <Image
                      src={product.imageUrl}
                      alt={product.imageAlt}
                      width={320}
                      height={240}
                      sizes="(max-width: 480px) 45vw, (max-width: 900px) 30vw, 210px"
                      loading="lazy"
                      unoptimized
                      referrerPolicy="no-referrer"
                      onError={() => markImageFailed(imageKey)}
                    />
                  )}
                </span>
                <span className="planet-product-card__copy">
                  <small>{product.category}</small>
                  <strong>{product.name}</strong>
                  <span>
                    {product.brand} · {product.memberShare} each
                  </span>
                </span>
                <span className="planet-product-card__group">
                  <UsersRound aria-hidden="true" size={16} />
                  {calculateProductSplit(product, pricing).membersNeeded} needed
                </span>
                <span className="planet-product-card__check" aria-hidden="true">
                  <Check size={16} strokeWidth={3} />
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="planet-breakdown" aria-live="polite">
          <div className="planet-breakdown__product">
            <div>
              <p className="planet-breakdown__label">Selected offer</p>
              <h3>{selectedProduct.name}</h3>
              <p>{selectedProduct.purpose}</p>
            </div>
            <div className="planet-breakdown__threshold">
              <UsersRound aria-hidden="true" size={20} />
              <span>
                <strong>
                  {split.membersNeeded} {selectedCommons.participantLabel}
                </strong>
                needed to open this price
              </span>
            </div>
            <div className="planet-breakdown__source-links">
              <a
                href={selectedProduct.productUrl}
                target="_blank"
                rel="noreferrer"
                className="planet-breakdown__source"
              >
                View bulk price source
              </a>
              {selectedProduct.comparisonUrl ? (
                <a
                  href={selectedProduct.comparisonUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="planet-breakdown__source"
                >
                  View comparison price
                </a>
              ) : null}
            </div>
          </div>

          <div className="planet-breakdown__money">
            <div className="planet-breakdown__headline">
              <span>
                You pay for {packLabel}
                <small>Regularly {formatMoney(split.regularPriceCents)}</small>
              </span>
              <strong>{formatMoney(split.memberPriceCents)}</strong>
            </div>

            <dl className="planet-breakdown__rows">
              <div>
                <dt>Seller gets</dt>
                <dd>{formatMoney(split.vendorCents)}</dd>
              </div>
              <div>
                <dt>Card fee (about)</dt>
                <dd>{formatMoney(split.stripeFeeCents)}</dd>
              </div>
              <div>
                <dt>{selectedCommons.name} share</dt>
                <dd>{formatMoney(split.commonsCutCents)}</dd>
              </div>
              <div>
                <dt>Cahootz share</dt>
                <dd>{formatMoney(split.cahootzCutCents)}</dd>
              </div>
              <div className="planet-breakdown__savings">
                <dt>Your savings</dt>
                <dd>
                  {formatMoney(split.memberSavingsCents)}
                  <small>{memberDiscountPercent}% less</small>
                </dd>
              </div>
            </dl>

            <div className="planet-breakdown__group-total">
              <p>When all {split.membersNeeded} spots fill</p>
              <dl>
                <div>
                  <dt>Members keep</dt>
                  <dd>
                    {formatMoney(split.memberSavingsCents * split.membersNeeded)}
                  </dd>
                </div>
                <div>
                  <dt>Commons gets</dt>
                  <dd>{formatMoney(groupCommonsTotalCents)}</dd>
                </div>
                <div>
                  <dt>Cahootz gets</dt>
                  <dd>
                    {formatMoney(split.cahootzCutCents * split.membersNeeded)}
                  </dd>
                </div>
              </dl>
              <div className="planet-breakdown__commons-use">
                <span>What that builds</span>
                <strong>
                  {formatMoney(groupCommonsTotalCents)} goes into the{" "}
                  {selectedCommons.name}
                </strong>
                <p>
                  Members could vote to put it toward{" "}
                  {formatFundingExamples(fundingExamples)}.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="planet-deal-tool__note">
        Members keep about {100 - pricing.itemMarginBps / 100}% of the savings.
        The seller gets the bulk price, the card fee comes out next, and what&apos;s
        left is split between the {selectedCommons.name} and Cahootz. Small items
        come in packs so the card fee doesn&apos;t eat the savings. Prices were
        checked in October 2026; availability can change. Examples do not
        include supplier confirmation, wholesale eligibility, shipping, or tax.
        No brand shown is affiliated with Cahootz.
      </p>
    </div>
  );
}
