export function WorkspaceSkeleton({ shell = true }: { shell?: boolean }) {
  const content = (
    <div
      className="content-area workspace-skeleton-content"
      aria-hidden="true"
    >
      <div className="workspace-skeleton-heading">
        <i className="workspace-skeleton-block" />
        <i className="workspace-skeleton-block" />
      </div>
      <div className="workspace-skeleton-panel">
        {Array.from({ length: 5 }, (_, index) => (
          <i className="workspace-skeleton-block" key={index} />
        ))}
      </div>
    </div>
  );

  if (!shell) {
    return (
      <div
        className="workspace-skeleton"
        role="status"
        aria-label="Loading page"
        aria-busy="true"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className="app-frame workspace-skeleton"
      role="status"
      aria-label="Loading workspace"
      aria-busy="true"
    >
      <aside className="sidebar workspace-skeleton-sidebar" aria-hidden="true">
        <div className="workspace-skeleton-brand">
          <span className="workspace-skeleton-block workspace-skeleton-logo" />
          <span className="workspace-skeleton-brand-lines">
            <i className="workspace-skeleton-block" />
            <i className="workspace-skeleton-block" />
          </span>
        </div>
        <span className="workspace-skeleton-block workspace-skeleton-section" />
        <div className="workspace-skeleton-nav">
          {Array.from({ length: 7 }, (_, index) => (
            <i className="workspace-skeleton-block" key={index} />
          ))}
        </div>
        <span className="workspace-skeleton-block workspace-skeleton-user" />
      </aside>
      <main className="main-column" aria-hidden="true">
        <header className="topbar workspace-skeleton-topbar">
          <i className="workspace-skeleton-block" />
          <i className="workspace-skeleton-block" />
        </header>
        {content}
      </main>
    </div>
  );
}
