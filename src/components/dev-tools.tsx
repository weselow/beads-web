"use client";

import dynamic from "next/dynamic";

const Agentation = dynamic(
  () => import("agentation").then((mod) => mod.Agentation),
  { ssr: false }
);

const ENABLED = process.env.NEXT_PUBLIC_DEV_TOOLS === "1";

export function DevTools() {
  if (!ENABLED) return null;
  return <Agentation />;
}
