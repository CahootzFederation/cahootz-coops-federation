import { createHash } from "node:crypto";
import { extname } from "node:path";
import { put } from "@vercel/blob";

type RawImportRow = {
  storeId?: string;
  name: string;
  description?: string;
  category: string;
  imageUrl?: string;
  images: string[];
  priceUSD: number;
  quantity?: number;
  trackInventory: boolean;
  sourceUrl?: string;
  isActive: boolean;
  isFeatured: boolean;
  sku?: string;
};

export type ParsedProductImportRow = RawImportRow & {
  rowNumber: number;
};

export type MirroredProductImages = {
  imageUrl?: string;
  images: string[];
  imageTotal: number;
  imagesUploaded: number;
  imageErrors: string[];
};

const KNOWN_HEADERS = new Set([
  "storeid",
  "store_id",
  "name",
  "description",
  "category",
  "imageurl",
  "image_url",
  "images",
  "priceusd",
  "price_usd",
  "price",
  "quantity",
  "trackinventory",
  "track_inventory",
  "sourceurl",
  "source_url",
  "isactive",
  "is_active",
  "isfeatured",
  "is_featured",
  "sku",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;

  throw new Error(`Invalid boolean value "${value}"`);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number "${value}"`);
  return parsed;
}

function parsePositiveNumber(value: string | undefined, fieldName: string): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined || parsed <= 0) throw new Error(`${fieldName} must be greater than 0`);
  return parsed;
}

function parseImages(value: string | undefined): string[] {
  if (!value) return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("images must be a JSON array of URLs");
    }
    return parsed.filter(Boolean);
  }

  return trimmed
    .split(/[,\n]/)
    .map((url) => url.trim())
    .filter(Boolean);
}

export function parseDelimitedProductRows(input: string): ParsedProductImportRow[] {
  const delimiter = input.includes("\t") ? "\t" : ",";
  const rows = parseDelimited(input, delimiter).filter((row) => row.some(Boolean));

  if (rows.length === 0) return [];

  const firstRowHeaders = rows[0].map(normalizeHeader);
  const hasHeader = firstRowHeaders.some((header) => KNOWN_HEADERS.has(header));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows.map((row, index) => {
    const rowNumber = hasHeader ? index + 2 : index + 1;

    if (hasHeader) {
      return parseHeaderRow(row, firstRowHeaders, rowNumber);
    }

    return parseHeaderlessRow(row, rowNumber);
  });
}

function parseHeaderRow(row: string[], headers: string[], rowNumber: number): ParsedProductImportRow {
  const value = (...names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? row[index]?.trim() : undefined;
  };

  const name = value("name");
  const category = value("category");

  if (!name) throw new Error(`Row ${rowNumber}: name is required`);
  if (!category) throw new Error(`Row ${rowNumber}: category is required`);

  return {
    rowNumber,
    storeId: value("storeid", "store_id"),
    name,
    description: value("description") || undefined,
    category,
    imageUrl: value("imageurl", "image_url") || undefined,
    images: parseImages(value("images")),
    priceUSD: parsePositiveNumber(value("priceusd", "price_usd", "price"), "priceUSD"),
    quantity: parseOptionalNumber(value("quantity")),
    trackInventory: parseBool(value("trackinventory", "track_inventory"), true),
    sourceUrl: value("sourceurl", "source_url") || undefined,
    isActive: parseBool(value("isactive", "is_active"), true),
    isFeatured: parseBool(value("isfeatured", "is_featured"), false),
    sku: value("sku") || undefined,
  };
}

function parseHeaderlessRow(row: string[], rowNumber: number): ParsedProductImportRow {
  const hasStoreId = row.length >= 11;
  const offset = hasStoreId ? 1 : 0;
  const name = row[offset]?.trim();
  const category = row[offset + 2]?.trim();

  if (!name) throw new Error(`Row ${rowNumber}: name is required`);
  if (!category) throw new Error(`Row ${rowNumber}: category is required`);

  return {
    rowNumber,
    storeId: hasStoreId ? row[0]?.trim() : undefined,
    name,
    description: row[offset + 1]?.trim() || undefined,
    category,
    imageUrl: row[offset + 3]?.trim() || undefined,
    images: parseImages(row[offset + 4]),
    priceUSD: parsePositiveNumber(row[offset + 5], "priceUSD"),
    trackInventory: parseBool(row[offset + 6], true),
    sourceUrl: row[offset + 7]?.trim() || undefined,
    isActive: parseBool(row[offset + 8], true),
    isFeatured: parseBool(row[offset + 9], false),
  };
}

function parseDelimited(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === "\"" && (inQuotes || field.length === 0)) {
      if (inQuotes && next === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === "[") bracketDepth += 1;
    if (!inQuotes && char === "]" && bracketDepth > 0) bracketDepth -= 1;

    if (!inQuotes && bracketDepth === 0 && char === delimiter) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (!inQuotes && bracketDepth === 0 && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);

  return rows;
}

async function withRetries<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(750 * 2 ** (attempt - 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";
}

function extensionFromUrl(url: string): string | undefined {
  const ext = extname(new URL(url).pathname).replace(".", "").toLowerCase();
  return ext || undefined;
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return "bin";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("heic")) return "heic";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}

function blobPath(storeId: string, productName: string, sourceUrl: string, index: number, contentType: string | null): string {
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12);
  const ext = extensionFromUrl(sourceUrl) ?? extensionFromContentType(contentType);
  const imageName = index === 0 ? "main" : `gallery-${index}`;
  return `products/${storeId}/${slugify(productName)}-${imageName}-${hash}.${ext}`;
}

async function mirrorImage(
  storeId: string,
  productName: string,
  imageUrl: string,
  index: number,
  retries: number,
): Promise<string> {
  if (imageUrl.includes("blob.vercel-storage.com")) return imageUrl;

  return withRetries(`${productName} image ${index + 1}`, retries, async () => {
    const response = await fetch(imageUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "CahootzProductImporter/1.0",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${imageUrl}`);

    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) throw new Error(`Downloaded empty image from ${imageUrl}`);

    const blob = await put(blobPath(storeId, productName, imageUrl, index, contentType), body, {
      access: "public",
      addRandomSuffix: true,
      contentType,
    });

    return blob.url;
  });
}

export async function mirrorProductImages(input: {
  storeId: string;
  productName: string;
  imageUrl?: string;
  images: string[];
  mirrorImages: boolean;
  retries: number;
}): Promise<MirroredProductImages> {
  const imageTotal = (input.imageUrl ? 1 : 0) + input.images.length;

  if (!input.mirrorImages) {
    return {
      imageUrl: input.imageUrl,
      images: input.images,
      imageTotal,
      imagesUploaded: 0,
      imageErrors: [],
    };
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to mirror product images");
  }

  const imageErrors: string[] = [];
  let imageUrl = input.imageUrl;
  let imagesUploaded = 0;
  const images: string[] = [];

  if (input.imageUrl) {
    try {
      imageUrl = await mirrorImage(input.storeId, input.productName, input.imageUrl, 0, input.retries);
      imagesUploaded += 1;
    } catch (error) {
      imageErrors.push(`Main image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (let i = 0; i < input.images.length; i += 1) {
    try {
      images.push(await mirrorImage(input.storeId, input.productName, input.images[i], i + 1, input.retries));
      imagesUploaded += 1;
    } catch (error) {
      imageErrors.push(`Gallery image ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { imageUrl, images, imageTotal, imagesUploaded, imageErrors };
}
