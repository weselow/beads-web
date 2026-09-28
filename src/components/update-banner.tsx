"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import { Download, Loader2, RefreshCw, X } from "lucide-react";

import * as api from "@/lib/api";

type UpdateState = "idle" | "downloading" | "restarting" | "error";

const RECHECK_INTERVAL_MS = 3600_000;
/** A tab switch re-checks the version at most this often. */
const VISIBLE_RECHECK_MIN_GAP_MS = 30_000;
/** The old server exits ~2s after answering POST /api/update. */
const RESTART_GRACE_MS = 3000;
const RESTART_POLL_MS = 1000;
const RESTART_MAX_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls /api/version/check until the server reports `target` as its running
 * version. Any answer before that may still come from the old server, so a
 * mere response is not enough. Gives up after RESTART_MAX_ATTEMPTS.
 */
async function waitForVersion(target: string | null): Promise<void> {
  await sleep(RESTART_GRACE_MS);
  for (let i = 0; i < RESTART_MAX_ATTEMPTS; i++) {
    if (i > 0) await sleep(RESTART_POLL_MS);
    try {
      const data = await api.version.check();
      if (data.current === target) return;
    } catch {
      // Server is down while the binary is replaced — keep polling
    }
  }
  console.warn(
    `Update: server did not report v${target} after ${RESTART_MAX_ATTEMPTS} attempts, reloading anyway`
  );
}

/**
 * Version info, checked on mount, every hour, and when the tab becomes
 * visible again — so a tab opened before an update stops offering it.
 */
function useVersionInfo() {
  const [info, setInfo] = useState<api.VersionCheckResponse | null>(null);
  const mountedRef = useRef(true);
  const lastCheckRef = useRef(0);

  const refresh = useCallback(async () => {
    lastCheckRef.current = Date.now();
    try {
      const data = await api.version.check();
      if (mountedRef.current) setInfo(data);
    } catch {
      // Silently ignore — version check is non-critical
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheckRef.current < VISIBLE_RECHECK_MIN_GAP_MS) return;
      refresh();
    };

    refresh();
    const interval = setInterval(refresh, RECHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  return { info, refresh };
}

export function UpdateBanner() {
  const { info, refresh } = useVersionInfo();
  const [dismissed, setDismissed] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleUpdate = useCallback(async () => {
    const target = info?.latest ?? null;
    setUpdateState("downloading");
    setErrorMessage(null);

    try {
      const result = await api.update.perform();
      if (result.error) {
        setUpdateState("error");
        setErrorMessage(result.error);
        return;
      }
      if (result.status === "up_to_date") {
        // This tab was stale: the server already runs the latest version
        await refresh();
        setUpdateState("idle");
        return;
      }

      setUpdateState("restarting");
      await waitForVersion(target);
      window.location.reload();
    } catch (err) {
      setUpdateState("error");
      setErrorMessage(err instanceof Error ? err.message : "Update failed");
    }
  }, [info, refresh]);

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
