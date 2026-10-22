import type { CSSProperties } from 'react';
export function LegalAssistantIcon({ size = 24, className = '', style }: { size?: number; className?: string; style?: CSSProperties; [key: string]: unknown }) {
 return <svg width={size} height={size} viewBox="0 0 36 36" className={className} style={style} aria-hidden="true"><rect width="36" height="36" rx="10" fill="currentColor" opacity=".06"/><path d="M2 2h16a16 16 0 0 1-16 16zM18 18h16a16 16 0 0 1-16 16z" fill="currentColor"/><path d="M20 16a12 12 0 0 1 12-12M4 32a12 12 0 0 1 12-12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
