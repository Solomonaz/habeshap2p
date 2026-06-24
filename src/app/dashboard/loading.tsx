import { PageSkeleton, Shimmer } from "@/components/skeletons";

export default function DashboardLoading() {
  return (
    <PageSkeleton maxWidth="max-w-2xl">
      <Shimmer className="h-7 w-32" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="panel p-5">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="mt-2 h-8 w-32" />
        </div>
        <div className="panel p-5">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="mt-2 h-8 w-32" />
        </div>
      </div>
      <div className="panel mt-4 p-5">
        <Shimmer className="h-4 w-28" />
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Shimmer className="h-12" />
          <Shimmer className="h-12" />
          <Shimmer className="h-12" />
        </div>
      </div>
      <div className="panel mt-4 p-5">
        <Shimmer className="h-4 w-36" />
        <Shimmer className="mt-3 h-10 w-full" />
      </div>
    </PageSkeleton>
  );
}
