import { Component, ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <main className="startup-shell" role="alert">
        <img src="/blocklens-logo.png" width="32" height="32" alt="BlockLens" />
        <h1>We couldn’t load this page.</h1>
        <p>Please reload to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
      </main>
    );
    return this.props.children;
  }
}
