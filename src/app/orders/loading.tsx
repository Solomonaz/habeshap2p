import { PageSkeleton, Shimmer, CardSkeleton } from "@/components/skeletons";

export default function OrdersLoading() {
  return (
    <PageSkeleton maxWidth="max-w-3xl">
      <Shimmer className="h-7 w-40" />
      <Shimmer className="mt-2 h-4 w-64" />
      <div className="mt-6 space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </PageSkeleton>
  );
}
