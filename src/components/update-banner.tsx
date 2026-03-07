"use client";

import { useState, useEffect } from "react";

import { Download, X } from "lucide-react";

import * as api from "@/lib/api";

export function UpdateBanner() {
  const [info, setInfo] = useState<api.VersionCheckResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const data = await api.version.check();
        if (mounted) setInfo(data);
      } catch {
        // Silently ignore — version check is non-critical
      }
    };

    check();
    const interval = setInterval(check, 3600_000); // Re-check every hour
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!info?.update_available || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-success/30 bg-surface-raised shadow-lg p-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 text-t-muted hover:text-t-primary rounded-sm p-0.5"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-4">
        <Download className="size-5 text-success shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-t-primary">
            Update available: v{info.latest}
          </p>
          <p className="text-xs text-t-muted">
            You&apos;re running v{info.current}
          </p>
          {info.download_url && (
            <a
              href={info.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-success hover:text-success/80 underline underline-offset-2"
            >
              Download from GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
