"use client";

import { useEffect, useMemo, useState } from "react";
import { Marker } from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { CHAIN_COLORS, CHAIN_INITIALS } from "@/lib/store-types";
import type { SupplyStore } from "@/lib/store-types";

// Preview stores for auth-bypass mode
const PREVIEW_STORES: SupplyStore[] = [
  {
    id: "store-001",
    chain: "Home Depot",
    name: "Home Depot - Daly City",
    address: "303 E Lake Merced Blvd, Daly City, CA",
    lat: 37.7105,
    lng: -122.4830,
    phone: "(650) 992-7800",
    place_id: null,
    is_active: true,
  },
  {
    id: "store-002",
    chain: "Lowe's",
    name: "Lowe's - San Francisco",
    address: "491 Bayshore Blvd, San Francisco, CA",
    lat: 37.7396,
    lng: -122.4035,
    phone: "(415) 513-7410",
    place_id: null,
    is_active: true,
  },
  {
    id: "store-003",
    chain: "Floor & Decor",
    name: "Floor & Decor - San Bruno",
    address: "1250 Grundy Ln, San Bruno, CA",
    lat: 37.6269,
    lng: -122.4118,
    phone: null,
    place_id: null,
    is_active: true,
  },
];

function makeStoreIcon(chain: string) {
  const color = CHAIN_COLORS[chain] ?? "#6B7280";
  return {
    path: 0 as google.maps.SymbolPath, // CIRCLE
    fillColor: color,
    fillOpacity: 0.75,
    strokeColor: "#0f1117",
    strokeWeight: 1.5,
    scale: 6,
    label: undefined,
  };
}

export function StoreMarkers({
  onStoreClick,
}: {
  onStoreClick?: (store: SupplyStore) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<SupplyStore[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("supply_stores")
        .select("*")
        .eq("is_active", true);

      if (data && data.length > 0) {
        setStores(data as SupplyStore[]);
      } else {
        // Fallback to preview stores
        setStores(PREVIEW_STORES);
      }
    }
    void load();
  }, [supabase]);

  return (
    <>
      {stores.map((store) => {
        const initials = CHAIN_INITIALS[store.chain] ?? "?";
        return (
          <Marker
            key={store.id}
            position={{ lat: store.lat, lng: store.lng }}
            icon={makeStoreIcon(store.chain)}
            title={`${initials} ${store.name}\n${store.address}`}
            onClick={() => onStoreClick?.(store)}
          />
        );
      })}
    </>
  );
}
