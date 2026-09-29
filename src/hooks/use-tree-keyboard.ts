"use client";

/**
 * Keys of the tree view, as the board has them (see use-keyboard-navigation):
 * arrows and j/k move the picked row, Home/End go to the first/last row,
 * right/left fold, unfold and walk the levels, Enter opens the picked bead,
 * Escape drops the pick or leaves the
 * search box, / goes to the search box. Keys typed in a text field stay there,
 * and nothing acts while the bead card is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { keepSelection, treeStep, type TreeMove, type TreeNode, type TreeStep } from "@/lib/tree";
import type { Bead } from "@/types";

export interface TreeKeyboardOptions {
  /** Whole tree, to find the ancestor that hides a picked row */
  roots: readonly TreeNode[];
  /** Rows on screen, in order */
  rows: readonly TreeNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenBead: (bead: Bead) => void;
  isDetailOpen: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

interface KeyContext extends Omit<TreeKeyboardOptions, "roots" | "isDetailOpen"> {
  selectedId: string | null;
  /** Pick a row; `focus` moves the keyboard focus to it too. */
  pick: (id: string | null, focus?: boolean) => void;
}

const STEPS: Readonly<Record<string, TreeStep>> = {
  ArrowUp: "up", k: "up", ArrowDown: "down", j: "down", ArrowRight: "right", ArrowLeft: "left",
  Home: "first", End: "last",
};

const isTextField = (el: HTMLElement) =>
  el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;

/** Menus and dialogs handle their own keys. */
const insidePopup = (el: HTMLElement) =>
  el.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') != null;

function escape(event: KeyboardEvent, target: HTMLElement, ctx: KeyContext): void {
  event.preventDefault();
  if (isTextField(target)) target.blur();
  else ctx.pick(null);
}

/** Enter on a button or link is that control's own click. */
function openPicked(event: KeyboardEvent, target: HTMLElement, ctx: KeyContext): void {
  if (target.tagName === "BUTTON" || target.tagName === "A") return;
  const node = ctx.rows.find((row) => row.bead.id === ctx.selectedId);
  if (!node) return;
  event.preventDefault();
  ctx.onOpenBead(node.bead);
}

function applyMove(move: TreeMove, ctx: KeyContext): void {
  if (move === null) return;
  if ("toggle" in move) ctx.onToggle(move.toggle);
  else ctx.pick(move.select, true);
}

function handleTreeKey(event: KeyboardEvent, ctx: KeyContext): void {
  const target = event.target as HTMLElement;
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || insidePopup(target)) return;
  if (event.key === "Escape") return escape(event, target, ctx);
  if (isTextField(target)) return;
  if (event.key === "Enter") return openPicked(event, target, ctx);
  if (event.key === "/") {
    event.preventDefault();
    ctx.searchInputRef?.current?.focus();
    return;
  }
  const step = STEPS[event.key];
  if (step === undefined) return;
  event.preventDefault();
  applyMove(treeStep(ctx.rows, ctx.collapsed, ctx.selectedId, step), ctx);
}

/** The picked row, kept on screen: a row hidden by folding hands the pick to its folded ancestor. */
function usePick(roots: readonly TreeNode[], rows: readonly TreeNode[]) {
  const [stored, setStored] = useState<string | null>(null);
  const selectedId = useMemo(() => keepSelection(roots, rows, stored), [roots, rows, stored]);
  if (selectedId !== stored) setStored(selectedId);
  return [selectedId, setStored] as const;
}

/** Focus and scroll to the picked row after a key moved the pick. */
function useFocusPicked(listRef: RefObject<HTMLUListElement | null>, rows: readonly TreeNode[], selectedId: string | null) {
  /** Row a key just picked, waiting to get focus. */
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (pending.current === null || pending.current !== selectedId) return;
    pending.current = null;
    const index = rows.findIndex((node) => node.bead.id === selectedId);
    const row = listRef.current?.children[index] as HTMLElement | undefined;
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  }, [listRef, rows, selectedId]);
  return pending;
}

export function useTreeKeyboard(options: TreeKeyboardOptions) {
  const { roots, rows, collapsed, onToggle, onOpenBead, isDetailOpen, searchInputRef } = options;
  const listRef = useRef<HTMLUListElement>(null);
  const [selectedId, setSelectedId] = usePick(roots, rows);
  const focusPending = useFocusPicked(listRef, rows, selectedId);
  const pick = useCallback((id: string | null, focus = false) => {
    focusPending.current = focus ? id : null;
    setSelectedId(id);
  }, [focusPending, setSelectedId]);

  useEffect(() => {
    if (isDetailOpen) return;
    const ctx: KeyContext = { rows, collapsed, onToggle, onOpenBead, searchInputRef, selectedId, pick };
    const onKeyDown = (event: KeyboardEvent) => handleTreeKey(event, ctx);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDetailOpen, rows, collapsed, onToggle, onOpenBead, searchInputRef, selectedId, pick]);

  return { selectedId, pick, listRef };
}
