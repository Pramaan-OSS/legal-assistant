import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export type PillButtonUITone = "black" | "white" | "blue" | "danger";
export type PillButtonUISize = "xs" | "icon-xs" | "sm" | "normal";

const toneClasses: Record<PillButtonUITone, string> = {
 black: 'pill-ink', white: 'pill-quiet', blue: 'pill-next', danger: 'pill-quiet',
};

const sizeClasses: Record<PillButtonUISize, string> = {
    xs: "h-6 px-2.5 text-[11px] leading-none has-[svg]:pl-1.5 has-[img]:pl-1.5",
    "icon-xs": "h-6 w-6 p-0 text-[11px] leading-none",
    sm: "h-[30px] px-3 text-xs leading-none has-[svg]:pl-2 has-[img]:pl-2",
    normal: "h-9 px-4 text-[13px] leading-none has-[svg]:pl-3 has-[img]:pl-3",
};

/**
 * `transition`, not `transition-all`: `all` includes `visibility`, which is
 * inherited. The assistant side panel keeps inactive tabs mounted and hides
 * them with `invisible`, so a pill inside one animated that inherited change
 * and stayed on screen for the transition's full duration after the user
 * switched tabs. Tailwind's default property list covers every visual property
 * these tones declare — color, background, border, box-shadow, opacity,
 * transform/scale, filter — and leaves visibility alone.
 */
export function pillButtonUIClassName({
    tone,
    size = "sm",
    className,
}: {
    tone: PillButtonUITone;
    size?: PillButtonUISize;
    className?: string;
}) {
    return twMerge(
        clsx(
            "pill inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-55",
            toneClasses[tone],
            sizeClasses[size],
            className,
        ),
    );
}
