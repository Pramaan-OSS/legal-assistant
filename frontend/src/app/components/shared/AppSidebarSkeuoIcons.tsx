import type { CSSProperties } from 'react';
import { MessageCircle, PanelsTopLeft, Folder, Library, Table2, GitBranch, Plug, Building2, Settings, LogOut, type LucideIcon } from 'lucide-react';
type IconProps = { className?: string; style?: CSSProperties; tone?: string; [key: string]: unknown };
function navigationIcon(Icon: LucideIcon) { return function NavigationIcon({ className, style, tone, ...props }: IconProps) { return <Icon {...props} size={16} strokeWidth={1.5} className={className} style={tone === "green" ? { ...style, color: "var(--ok)" } : style} data-status={tone === "green" ? "complete" : undefined} aria-hidden="true"/>; }; }
export const ChatSkeuoIcon = navigationIcon(MessageCircle);
export const IdeSkeuoIcon = navigationIcon(PanelsTopLeft);
export const FolderSkeuoIcon = navigationIcon(Folder);
export const LibrarySkeuoIcon = navigationIcon(Library);
export const TabularReviewSkeuoIcon = navigationIcon(Table2);
export const WorkflowSkeuoIcon = navigationIcon(GitBranch);
export const ConnectorSkeuoIcon = navigationIcon(Plug);
export const OrganizationSkeuoIcon = navigationIcon(Building2);
export const SettingsSkeuoIcon = navigationIcon(Settings);
export const SignOutSkeuoIcon = navigationIcon(LogOut);
