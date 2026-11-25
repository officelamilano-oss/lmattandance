"use client";

import { useEffect } from "react";

export default function WorkspaceError({
  error,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Workspace page failed to load.", error);
  }, [error]);

  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "An unexpected error occurred while loading this page.";

  return (
    <section className="content-area" role="alert">
      <div className="eyebrow">PAGE ERROR</div>
      <h1>We couldn’t load this page.</h1>
      <p>{message} Try reloading the page.</p>
      <button
        className="button button-primary"
        type="button"
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </section>
  );
}
