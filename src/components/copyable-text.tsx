"use client";

import { useState, useCallback } from "react";

import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

interface CopyableTextProps {
  /** Text to display */
  children: React.ReactNode;
  /** Text to copy to clipboard (defaults to children text content) */
  copyText: string;
  className?: string;
  variant?: 'default' | 'pill';
}

/**
 * Inline text that copies to clipboard on click.
 * Shows a checkmark + "Copied" for 2 seconds after copying.
 * Supports a pill variant that renders as a copyable badge.
 */
export function CopyableText({ children, copyText, className, variant = 'default' }: CopyableTextProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for insecure contexts
    }
  }, [copyText]);

  if (variant === 'pill') {
    return (
      <span
        onClick={handleCopy}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-b-default bg-surface-raised/50 text-xs font-mono cursor-copy hover:border-t-secondary/50 transition-colors group",
          className
        )}
        title={`Click to copy: ${copyText}`}
      >
        {copied ? (
          <Check className="size-3 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
        )}
        {children}
      </span>
    );
  }

  if (copied) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-success", className)}>
        <Check className="size-3" aria-hidden="true" />
        Copied
      </span>
    );
  }

  return (
    <span
      onClick={handleCopy}
      className={cn("cursor-copy hover:text-t-secondary transition-colors", className)}
      title={`Click to copy: ${copyText}`}
    >
      {children}
    </span>
  );
}
