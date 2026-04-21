/**
 * @file Streaming fallback for `/dashboard`.
 *
 * Next renders this instantly while the page's RSC fetch resolves —
 * the user sees the rail/chat skeleton at first byte, never a blank
 * dashboard. Kept intentionally markup-only; nothing here should call
 * any data hooks.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="isolate flex min-h-0 flex-1 flex-col">
      <div className="bg-surface border-on-surface/10 flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <Skeleton className="size-7 rounded-[var(--radius-xs)]" />
        <Skeleton className="h-4 w-28" />
      </div>

      <div className="mx-auto flex w-full max-w-[1680px] flex-1 overflow-hidden">
        <aside
          aria-hidden="true"
          className="bg-surface border-on-surface/10 flex w-72 shrink-0 flex-col gap-4 border-r p-4 max-md:hidden lg:w-80"
        >
          <Skeleton className="h-9 w-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        </aside>

        <div className="bg-surface-dim flex min-h-0 flex-1 items-center justify-center">
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    </div>
  );
}
