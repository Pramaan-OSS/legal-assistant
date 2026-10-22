import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import {
  closeHttpServer,
  createShutdown,
  failBoot,
  listenOrFail,
  type LifecycleEffects,
} from "../processLifecycle";

function fakeEffects() {
  return {
    report: vi.fn<LifecycleEffects["report"]>(() => null),
    logError: vi.fn<LifecycleEffects["logError"]>(),
    logInfo: vi.fn<LifecycleEffects["logInfo"]>(),
    flush: vi.fn<LifecycleEffects["flush"]>(async () => {}),
    exit: vi.fn<LifecycleEffects["exit"]>(),
  } satisfies LifecycleEffects;
}



describe("failBoot (LEGAL_ASSISTANT-BACKEND-2 / -3)", () => {
  // One failed boot used to arrive as two issues: the explicit fatal report
  // and a console-bridge copy of the logged message string. Runs the real
  // console integration and beforeSend so the dedupe is exercised end to end.


  it("reports the failure as fatal with its boot stage before exiting", async () => {
    const effects = fakeEffects();
    const failure = new Error("bad key");
    await failBoot(failure, "manifest-key", effects);
    expect(effects.report).toHaveBeenCalledWith(failure, {
      tags: { component: "boot", stage: "manifest-key" },
      level: "fatal",
    });
    expect(effects.logError).toHaveBeenCalledWith(
      expect.any(String),
      failure,
    );
    expect(effects.exit).toHaveBeenCalledWith(1);
  });

  // LEGAL_ASSISTANT-BACKEND-N: 54 "Failure in boot" events from a restart loop, none of
  // which said WHICH variable was wrong. Runs the real validator, failBoot,
  // beforeSend and the outbound privacy boundary: the event that leaves the
  // process must be titled by stage + code and carry the field NAMES only.

});

describe("listenOrFail (LEGAL_ASSISTANT-BACKEND-7 root cause)", () => {
  it("fails the boot instead of reporting 'running' when the port is taken", async () => {
    const holder = http.createServer();
    await new Promise<void>((resolve) => holder.listen(0, resolve));
    const port = (holder.address() as AddressInfo).port;
    const effects = fakeEffects();
    const onListening = vi.fn();
    try {
      const server = listenOrFail(express(), port, onListening, effects);
      await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledWith(1));
      expect(onListening).not.toHaveBeenCalled();
      expect(effects.report).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EADDRINUSE" }),
        { tags: { component: "boot", stage: "listen" }, level: "fatal" },
      );
      expect(server.listening).toBe(false);
    } finally {
      await new Promise((resolve) => holder.close(resolve));
    }
  });

  it("calls back once the port is bound", async () => {
    const effects = fakeEffects();
    const onListening = vi.fn();
    const server = listenOrFail(express(), 0, onListening, effects);
    await vi.waitFor(() => expect(onListening).toHaveBeenCalledOnce());
    expect(effects.exit).not.toHaveBeenCalled();
    await new Promise((resolve) => server.close(resolve));
  });

  it("binds only to the requested host for the desktop local stack", async () => {
    const effects = fakeEffects();
    const onListening = vi.fn();
    const server = listenOrFail(express(), 0, onListening, effects, "127.0.0.1");
    try {
      await vi.waitFor(() => expect(onListening).toHaveBeenCalledOnce());
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
      expect(effects.exit).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("graceful shutdown (LEGAL_ASSISTANT-BACKEND-7)", () => {
  it("treats a server that never bound its port as already closed", async () => {
    const neverListened = http.createServer();
    await expect(closeHttpServer(neverListened)).resolves.toBeUndefined();

    const effects = fakeEffects();
    const shutdown = createShutdown({
      closeServer: () => closeHttpServer(neverListened),
      stopBackgroundWork: async () => {},
      effects,
    });
    await shutdown("SIGTERM");
    expect(effects.report).not.toHaveBeenCalled();
    expect(effects.exit).toHaveBeenCalledWith(0);
  });

  it("still rejects a genuine close failure", async () => {
    const broken = {
      close: (callback?: (err?: Error) => void) => {
        callback?.(Object.assign(new Error("boom"), { code: "EIO" }));
        return broken;
      },
    } as unknown as http.Server;
    await expect(closeHttpServer(broken)).rejects.toThrow("boom");
  });

  it("runs once when a second signal arrives mid-shutdown", async () => {
    const effects = fakeEffects();
    let release!: () => void;
    const stopBackgroundWork = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const onStart = vi.fn();
    const shutdown = createShutdown({
      closeServer: async () => {},
      stopBackgroundWork,
      onStart,
      effects,
    });
    const first = shutdown("SIGINT");
    await vi.waitFor(() => expect(stopBackgroundWork).toHaveBeenCalled());
    await shutdown("SIGTERM");
    release();
    await first;
    expect(onStart).toHaveBeenCalledOnce();
    expect(stopBackgroundWork).toHaveBeenCalledOnce();
    expect(effects.exit).toHaveBeenCalledOnce();
    expect(effects.exit).toHaveBeenCalledWith(0);
  });

  it("reports a genuine failure with the stage that failed", async () => {
    const effects = fakeEffects();
    const failure = new Error("worker would not stop");
    const shutdown = createShutdown({
      closeServer: async () => {},
      stopBackgroundWork: async () => {
        throw failure;
      },
      effects,
    });
    await shutdown("SIGTERM");
    expect(effects.report).toHaveBeenCalledWith(failure, {
      tags: { component: "shutdown", stage: "shutdown-workers" },
    });
    expect(effects.exit).toHaveBeenCalledWith(1);
  });
});
