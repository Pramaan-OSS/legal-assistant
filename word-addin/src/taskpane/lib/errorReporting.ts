import { Component, type ReactNode } from 'react';
export type ReportLevel = 'fatal' | 'error' | 'warning';
export type ReportContext = { tags?: Record<string, unknown>; extra?: Record<string, unknown>; level?: ReportLevel; fingerprint?: string[] };
export function initAddinErrorReporting(_surface: string): boolean { return false; }
export function tagOfficeHost(): void {}
export function reportError(_error: unknown, _context?: ReportContext): null { return null; }
export function reportWordFailure(_error: unknown, _context: unknown): null { return null; }
export function reportApiFailure(_failure: unknown): null { return null; }
export function reportNetworkFailure(_error: unknown, _context?: unknown): null { return null; }
export function setReportingUser(_user: { id: string } | null): void {}
export class ErrorBoundary extends Component<{ children: ReactNode; fallback: (args: { resetError: () => void }) => ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback({ resetError: () => this.setState({ failed: false }) }) : this.props.children; }
}
