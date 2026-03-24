"use client";

import { useState, useEffect, useCallback } from "react";

import { Download, Loader2, RefreshCw, X } from "lucide-react";

import * as api from "@/lib/api";

type UpdateState = "idle" | "downloading" | "restarting" | "error";

export function UpdateBanner() {
  const [info, setInfo] = useState<api.VersionCheckResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const handleUpdate = useCallback(async () => {
    setUpdateState("downloading");
    setErrorMessage(null);

    try {
      const result = await api.update.perform();
      if (result.error) {
        setUpdateState("error");
        setErrorMessage(result.error);
        return;
      }

      setUpdateState("restarting");

      // Wait for server to restart, then reload
      setTimeout(() => {
        const checkServer = async () => {
          for (let i = 0; i < 20; i++) {
            try {
              await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || ''}/api/health`, {
                signal: AbortSignal.timeout(2000),
              });
              window.location.reload();
              return;
            } catch {
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
          // After 20 attempts, reload anyway
          window.location.reload();
        };
        checkServer();
      }, 3000);
    } catch (err) {
      setUpdateState("error");
      setErrorMessage(err instanceof Error ? err.message : "Update failed");
    }
  }, []);

  if (!info?.update_available || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-success/30 bg-surface-raised shadow-lg p-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 text-t-muted hover:text-t-primary rounded-sm p-0.5"
        aria-label="Dismiss"
        disabled={updateState === "downloading" || updateState === "restarting"}
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

          {updateState === "error" && errorMessage && (
            <p className="text-xs text-destructive mt-1">
              {errorMessage}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2">
            {info.asset_url && updateState !== "restarting" && (
              <button
                onClick={handleUpdate}
                disabled={updateState === "downloading"}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-success hover:text-success/80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updateState === "downloading" ? (
                  <>
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3" aria-hidden="true" />
                    Update &amp; Restart
                  </>
                )}
              </button>
            )}

            {updateState === "restarting" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-t-muted">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Restarting server...
              </span>
            )}

            {info.download_url && updateState === "idle" && (
              <a
                href={info.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-t-muted hover:text-t-secondary underline underline-offset-2"
              >
                GitHub
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
