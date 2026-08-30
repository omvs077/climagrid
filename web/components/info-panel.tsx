"use client";

import { useEffect, useState } from "react";
import { fetchMeta, type MetaResponse } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Spinner } from "@/components/spinner";

const SOURCE_LABELS: Record<string, string> = {
  gee: "Satellite temperature & vegetation (Google Earth Engine)",
  overpass: "Building & road data (OpenStreetMap)",
  open_meteo: "Current weather context (Open-Meteo)",
};

function SourceStatusBadge({ status }: { status: string }) {
  const isLive = status === "live";
  const isMock = status === "mock";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isLive
          ? "bg-emerald-500/15 text-emerald-500"
          : isMock
          ? "bg-amber-500/15 text-amber-500"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isLive ? "LIVE" : isMock ? "MOCK DATA" : status.toUpperCase()}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function InfoPanel({ city, onClose }: { city: string; onClose: () => void }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaError, setMetaError] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    fetchMeta()
      .then(setMeta)
      .catch(() => {
        setMetaError(true);
        showToast("Couldn't load data source details right now.", "error");
      });
  }, [showToast]);

  const cityMeta = meta?.cities.find((c) => c.city === city);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">About ClimaGrid</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            âœ•
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          ClimaGrid is a public, educational visualization of urban heat and climate patterns in Pune, India.
          It is intended to raise awareness of urban heat islands and their relationship to vegetation and
          density &mdash; it is <strong>not</strong> a policy-of-record tool, and should not be used as the sole
          basis for planning or safety decisions.
        </p>

        <div className="mb-4">
          <h3 className="mb-1 text-sm font-medium">How the heat vulnerability score works</h3>
          <p className="text-sm text-muted-foreground">
            Each ward&apos;s Heat Vulnerability Index (HVI) is a weighted blend, normalized 0&ndash;1:
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            <li>40% relative surface temperature</li>
            <li>25% vegetation deficit (less greenery = higher score)</li>
            <li>20% built-up density</li>
            <li>15% road/traffic density</li>
          </ul>
        </div>

        <div className="mb-4">
          <h3 className="mb-1 text-sm font-medium">Smooth heat surface</h3>
          <p className="text-sm text-muted-foreground">
            The colored surface is smoothed between sample points for visual clarity and does not represent
            precise boundaries. Hover anywhere on the map for the exact reading at that location.
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Data sources & freshness</h3>
          {!meta && !metaError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              Loading&hellip;
            </div>
          )}
          {metaError && (
            <p className="text-sm text-muted-foreground">
              Data source details are temporarily unavailable.
            </p>
          )}
          {meta && !cityMeta && (
            <p className="text-sm text-muted-foreground">No pipeline run recorded for this city yet.</p>
          )}
          {cityMeta && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Last updated: {formatTimestamp(cityMeta.last_updated_at)} &middot; status:{" "}
                <span className="font-medium">{cityMeta.last_run_status}</span>
              </p>
              <ul className="space-y-1.5 text-sm">
                {Object.entries(cityMeta.sources_used).map(([key, status]) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{SOURCE_LABELS[key] ?? key}</span>
                    <SourceStatusBadge status={status} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Data marked &ldquo;MOCK DATA&rdquo; is synthetic (used for demonstration in the absence of live
                satellite credentials); &ldquo;LIVE&rdquo; sources are fetched fresh on each pipeline run.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}