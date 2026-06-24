import { Shimmer } from "@/components/skeletons";

export default function AdminLoading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Shimmer className="h-8 w-44" />
      <Shimmer className="mt-2 h-4 w-80" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-5">
            <Shimmer className="h-4 w-24" />
            <Shimmer className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
      <Shimmer className="mt-9 h-6 w-40" />
      <div className="mt-5 space-y-2.5">
        <Shimmer className="h-20 w-full rounded-xl" />
        <Shimmer className="h-20 w-full rounded-xl" />
      </div>
    </main>
  );
}
