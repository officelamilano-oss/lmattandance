"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function useInView<T extends Element>(rootMargin = "300px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      void Promise.resolve().then(() => setInView(true));
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

export function LazySection({
  children,
  minHeight = 280,
  rootMargin,
  fallback,
}: {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
  fallback?: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(rootMargin);
  return (
    <div ref={ref} style={inView ? undefined : { minHeight }}>
      {inView
        ? children
        : (fallback ?? <div className="loading-state">Loading…</div>)}
    </div>
  );
}
