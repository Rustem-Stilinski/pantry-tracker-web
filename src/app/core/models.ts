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
