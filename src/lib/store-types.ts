export const STORE_CHAINS = [
  "Home Depot",
  "Lowe's",
  "Floor & Decor",
  "Harbor Freight",
  "Ferguson",
  "Supply Masters",
  "Home Depot Pro",
  "Menards",
  "Ace Hardware",
  "Other",
] as const;

export type StoreChain = (typeof STORE_CHAINS)[number];

export const CHAIN_COLORS: Record<string, string> = {
  "Home Depot": "#f97316",
  "Lowe's": "#3b82f6",
  "Floor & Decor": "#ef4444",
  "Harbor Freight": "#ea580c",
  "Ferguson": "#6B7280",
  "Supply Masters": "#a855f7",
  "Home Depot Pro": "#f97316",
  "Menards": "#22c55e",
  "Ace Hardware": "#ef4444",
  "Other": "#6B7280",
};

export const CHAIN_INITIALS: Record<string, string> = {
  "Home Depot": "HD",
  "Lowe's": "L",
  "Floor & Decor": "FD",
  "Harbor Freight": "HF",
  "Ferguson": "F",
  "Supply Masters": "SM",
  "Home Depot Pro": "HP",
  "Menards": "M",
  "Ace Hardware": "AH",
  "Other": "?",
};

export interface SupplyStore {
  id: string;
  chain: StoreChain;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  place_id: string | null;
  is_active: boolean;
}

export interface StoreVisit {
  id: string;
  worker_id: string;
  worker_name: string;
  store_id: string;
  store_name: string;
  store_chain: string;
  shift_id: string | null;
  entered_at: string;
  exited_at: string | null;
  duration_seconds: number;
  source_project_id: string | null;
  source_project_name: string | null;
}
