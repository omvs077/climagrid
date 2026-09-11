"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMap, MapMarker, MarkerContent, MarkerPopup } from "@/components/ui/map";
import { useToast } from "@/components/toast";

interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

interface PinnedLocation extends GeocodeResult {
  id: string;
}

const DEBOUNCE_MS = 400;
const FLY_TO_ZOOM = 15;

function makePinId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AddressSearch() {
  const { map, isLoaded } = useMap();
  const { showToast } = useToast();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [pins, setPins] = useState<PinnedLocation[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(
    async (q: string) => {
      if (q.trim().length < 3) {
        setResults([]);
        setIsOpen(false);
        return;
      }
      setIsSearching(true);
      try {
        const res = await fetch(`/api/v1/geocode?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.error) {
          showToast(data.error, "error");
          setResults([]);
        } else {
          setResults(data.results ?? []);
          setIsOpen(true);
        }
      } catch {
        showToast("Address search failed. Please try again.", "error");
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [showToast],
  );

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  function handleSelect(result: GeocodeResult) {
    if (!map || !isLoaded) return;
    setPins((prev) => [...prev, { ...result, id: makePinId() }]);
    setQuery("");
    setResults([]);
    setIsOpen(false);
    map.flyTo({ center: [result.lon, result.lat], zoom: FLY_TO_ZOOM, essential: true });
  }

  function removePin(id: string) {
    setPins((prev) => prev.filter((p) => p.id !== id));
  }

  function clearAllPins() {
    setPins([]);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute top-4 left-1/2 z-10 w-72 -translate-x-1/2">
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search an address in Pune..."
          className="w-full rounded-lg border bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur outline-none focus:ring-2 focus:ring-primary"
        />
        {isSearching && (
          <div className="absolute right-3 top-2.5 text-xs text-muted-foreground">...</div>
        )}
        {isOpen && results.length > 0 && (
          <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border bg-background/95 shadow-sm backdrop-blur">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => handleSelect(r)}
                  className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                  title={r.label}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {pins.length > 0 && (
          <div className="mt-1 flex justify-end">
            <button
              onClick={clearAllPins}
              className="rounded bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            >
              Clear all pins ({pins.length})
            </button>
          </div>
        )}
      </div>

      {pins.map((pin) => (
        <MapMarker key={pin.id} longitude={pin.lon} latitude={pin.lat}>
          <MarkerContent />
          <MarkerPopup closeButton>
            <div className="max-w-xs p-2 text-sm">
              <p className="mb-2">{pin.label}</p>
              <button
                onClick={() => removePin(pin.id)}
                className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:opacity-90"
              >
                Remove pin
              </button>
            </div>
          </MarkerPopup>
        </MapMarker>
      ))}
    </>
  );
}