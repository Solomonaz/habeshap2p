import { PageSkeleton, Shimmer, CardSkeleton } from "@/components/skeletons";

export default function MyAdsLoading() {
  return (
    <PageSkeleton maxWidth="max-w-2xl">
      <div className="flex items-center justify-between">
        <Shimmer className="h-7 w-32" />
        <Shimmer className="h-10 w-28 rounded-lg" />
      </div>
      <div className="mt-6 space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </PageSkeleton>
  );
}
