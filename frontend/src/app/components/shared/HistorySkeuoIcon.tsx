import type { CSSProperties } from 'react';
import { History } from 'lucide-react';
export function HistorySkeuoIcon({ className, style, ...props }: { className?: string; style?: CSSProperties; [key: string]: unknown }) {
 return <History {...props} size={16} strokeWidth={1.5} className={className} style={style} aria-hidden="true"/>;
}
