import { useEffect, useState } from "react";
import { getLocalModels, type LocalModelOption } from "@/app/lib/legalAssistantApi";


// is unreachable — the app works without it.
let cache: LocalModelOption[] | null = null;
let inflight: Promise<LocalModelOption[]> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<LocalModelOption[]> {
    if (cache) return Promise.resolve(cache);
    if (!inflight) {
        inflight = getLocalModels()
            .then((m) => {
                cache = m;
                listeners.forEach((l) => l());
                return m;
            })
            .catch(() => {
                inflight = null; // don't poison cache — retry on next load
                return [];
            });
    }
    return inflight;
}

export function useLocalModels(): LocalModelOption[] {
    const [models, setModels] = useState<LocalModelOption[]>(cache ?? []);

    useEffect(() => {
        const update = () => setModels(cache ?? []);
        listeners.add(update);
        void load().then(update);
        return () => {
            listeners.delete(update);
        };
    }, []);

    return models;
}
