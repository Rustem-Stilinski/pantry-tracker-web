/** Shapes returned by the Spring Boot API. Timestamps are ISO-8601 strings. */

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface HouseholdSummary {
  id: string;
  name: string;
}

export interface Member {
  userId: string;
  displayName: string;
  role: 'OWNER' | 'MEMBER';
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  members: Member[];
}

export interface Entry {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  category: string;
  note: string | null;
  usedAt: string;
  loggedBy: string | null;
  createdAt: string;
}

export interface ItemTotal {
  itemKey: string;
  itemName: string;
  unit: string;
  category: string;
  quantity: number;
  times: number;
  lastUsedAt: string;
}

export interface FrequentItem {
  itemName: string;
  quantity: number;
  unit: string;
  category: string;
  timesUsed: number;
  lastUsedAt: string;
}

export interface NewEntry {
  itemName: string;
  quantity: number;
  unit: string;
  category: string;
  note?: string | null;
  /** Omit for "just now". */
  usedAt?: string;
}

// ---------- prices ----------

/** Which reader the server offers; without a Claude key, photos are read on the device. */
export interface ReaderStatus {
  claude: boolean;
}

/** What a printed receipt line ("GV 2% MLK GAL") was last saved as. */
export interface ReceiptAlias {
  receiptText: string;
  name: string;
  unit: string;
  category: string;
}

/** What Claude read off a receipt photo; any field can be null. Nothing is saved yet. */
export interface ReceiptDraft {
  storeName: string | null;
  /** The branch, as printed under the store's name: "11620 Monument Dr, Fairfax, VA 22030". */
  storeLocation?: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  currency: string | null;
  items: DraftItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  notes: string | null;
}

export interface DraftItem {
  receiptText: string | null;
  /** The product code printed for the line, digits only (Safeway: the UPC without its end digits). */
  itemCode?: string | null;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  category: string;
  /** Another reading of the line total worth checking, when the lines don't add up (on-device reading only). */
  suggestion?: number | null;
}

export interface SaveReceipt {
  storeName: string;
  storeLocation: string | null;
  purchasedAt: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  items: {
    name: string;
    receiptText: string | null;
    itemCode?: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    lineTotal: number;
    category: string;
  }[];
}

export interface ReceiptSummary {
  id: string;
  storeName: string;
  storeLocation: string | null;
  purchasedAt: string;
  total: number;
  itemCount: number;
}

export interface ReceiptLine {
  id: string;
  name: string;
  receiptText: string | null;
  itemCode?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  category: string;
}

export interface ReceiptDetail {
  id: string;
  storeName: string;
  storeLocation: string | null;
  purchasedAt: string;
  subtotal: number | null;
  tax: number | null;
  total: number;
  createdBy: string | null;
  items: ReceiptLine[];
  priceChanges: PriceChange[];
}

export interface PriceChange {
  itemKey: string;
  itemName: string;
  unit: string;
  previousPrice: number;
  previousStore: string;
  previousAt: string;
  latestPrice: number;
  latestStore: string;
  latestAt: string;
  changePercent: number;
}

export interface ItemPrice {
  itemKey: string;
  itemName: string;
  unit: string;
  category: string;
  latestPrice: number;
  latestStore: string;
  latestAt: string;
  changePercent: number | null;
  lowestPrice: number;
  lowestStore: string;
  lowestAt: string;
  averagePrice: number;
  purchases: number;
  storeCount: number;
}

export interface PricesOverview {
  changes: PriceChange[];
  items: ItemPrice[];
}

export interface PricePoint {
  receiptId: string;
  purchasedAt: string;
  storeName: string;
  storeLocation: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface StorePrice {
  storeName: string;
  latestPrice: number;
  latestAt: string;
  lowestPrice: number;
  purchases: number;
}

export interface ItemHistory {
  summary: ItemPrice;
  stores: StorePrice[];
  points: PricePoint[];
}

export interface StoreComparison {
  itemKey: string;
  itemName: string;
  unit: string;
  category: string;
  stores: StorePrice[];
  savingsPercent: number;
}

export interface Amount {
  name: string;
  amount: number;
}

export interface MonthSpending {
  month: string;
  total: number;
  receipts: number;
  byStore: Amount[];
  byCategory: Amount[];
}

// ---------- barcodes ----------

/** A name for a new barcode from a public product database. */
export interface BarcodeSuggestion {
  name: string;
  brand: string | null;
  size: string | null;
  source: string;
}

/** What a scanned barcode is for this log. */
export interface BarcodeLookup {
  /** Canonical form (13 digits for most products); use it when saving. */
  code: string;
  known: boolean;
  itemName: string | null;
  /** Only for a barcode the log hasn't named, when the product database has it. */
  suggestion: BarcodeSuggestion | null;
  /** The item's receipt prices, when it's been on a receipt. */
  prices: ItemPrice | null;
  /** The code on a receipt line that just linked this barcode ("2113050504"), else null. */
  receiptCode?: string | null;
}

/** A code linked to an item: a scanned barcode, or the code printed on its receipt lines. */
export interface ItemBarcode {
  code: string;
  itemName: string;
  source?: 'scan' | 'receipt';
}

export interface YearSpending {
  year: number;
  total: number;
  months: MonthSpending[];
}
