import { PageSkeleton, Shimmer, CardSkeleton } from "@/components/skeletons";

export default function MarketLoading() {
  return (
    <PageSkeleton>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Shimmer className="h-8 w-48" />
          <Shimmer className="h-4 w-72" />
        </div>
        <Shimmer className="h-10 w-32 rounded-lg" />
      </div>
      <div className="panel mt-7 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <Shimmer className="h-10 w-44 rounded-xl" />
          <Shimmer className="h-9 w-16 rounded-lg" />
        </div>
        <div className="mt-5 flex gap-3 border-b border-paper-border pb-5">
          <Shimmer className="h-9 w-20" />
          <Shimmer className="h-9 w-36 rounded-lg" />
          <Shimmer className="h-9 w-40 rounded-lg" />
        </div>
        <div className="mt-4 space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </PageSkeleton>
  );
}
