"use client";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export interface GitHubWarningDialogProps {
  open: boolean;
  /** No GitHub remote at all; otherwise the GitHub CLI is not signed in */
  hasRemote: boolean;
  onDismiss: () => void;
}

/** Tells the user the PR features are off for this project, and why */
export function GitHubWarningDialog({ open, hasRemote, onDismiss }: GitHubWarningDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>GitHub Integration Unavailable</AlertDialogTitle>
          <AlertDialogDescription>
            {!hasRemote
              ? "This repository doesn't have a GitHub remote configured."
              : "GitHub CLI is not authenticated."}
            {" "}PR features (Create PR, Merge PR, status checks) will not be available.
            You can still work on tasks locally.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button>Continue Without GitHub</Button>} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
