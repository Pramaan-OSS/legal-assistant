import Link from 'next/link';
export function SiteLogo({ className = '', asLink = false, ..._props }: { size?: string; className?: string; iconClassName?: string; animate?: boolean; asLink?: boolean }) {
 const mark = <span className={`wordmark ${className}`}><i aria-hidden="true"/>Legal Assistant</span>;
 return asLink ? <Link href="/" aria-label="Legal Assistant, all projects">{mark}</Link> : mark;
}
