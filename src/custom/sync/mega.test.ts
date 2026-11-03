import { describe, expect, it } from "vitest";
import { envelope, freshCheckpoint, reconcile } from "./protocol";

import { MegaProvider } from "../../utils/main/custom/megaTransport.mjs";

import { server } from "../../../e2e/android/mega-fixtures.cjs";

describe("MEGA transfers through the installed SDK", () => {
  it("creates a directory, uploads encrypted bytes, restores the tree and reads the same snapshot", async () => {
    const remote = server(), state = envelope(reconcile(freshCheckpoint(), {}, []));
    const first = new MegaProvider(await remote.open(), "default");
    await first.append(state); await first.close();
    const second = new MegaProvider(await remote.open(), "default");
    expect(await second.read()).toEqual([state]);
    await second.append(state); await second.close();
    expect(remote.nodes.filter((node) => node.t === 1)).toHaveLength(1);
    expect(remote.nodes.filter((node) => node.t === 0)).toHaveLength(1);
    expect(remote.commands.filter((command) => ["u", "g"].includes(command.a)).every((command) => command.ssl === 2)).toBe(true);
  });
  it("reuses the existing directory and reads its snapshots when a file tree lists children before parents", async () => {
    const remote = server(), state = envelope(reconcile(freshCheckpoint(), {}, []));
    const first = new MegaProvider(await remote.open(), "default");
    await first.append(state); await first.close();
    remote.reverseTree();
    const second = new MegaProvider(await remote.open(), "default");
    const received = await second.read();
    await second.append(state); await second.close();
    expect(remote.nodes.filter((node) => node.t === 1)).toHaveLength(1);
    expect(received).toEqual([state]);
  });
  it("fails a broken upload promptly and reuses its folder on the next sync", async () => {
    const remote = server(), state = envelope(reconcile(freshCheckpoint(), {}, []));
    const first = new MegaProvider(await remote.open(), "default");
    remote.failUpload(true);
    await expect(first.append(state)).rejects.toThrow("Synthetic upload failure");
    await first.close(); remote.failUpload(false); remote.reverseTree();
    const second = new MegaProvider(await remote.open(), "default");
    await second.append(state);
    expect(await second.read()).toEqual([state]); await second.close();
    expect(remote.nodes.filter((node) => node.t === 1)).toHaveLength(1);
  });
  it("propagates a failing download body instead of leaving a pending stream until timeout", async () => {
    const remote = server(), state = envelope(reconcile(freshCheckpoint(), {}, []));
    const provider = new MegaProvider(await remote.open(), "default");
    await provider.append(state); remote.failDownload(true);
    await expect(provider.read()).rejects.toThrow("Synthetic response-body failure");
    remote.failDownload(false);
    expect(await provider.read()).toEqual([state]); await provider.close();
  });
  it("round-trips a snapshot large enough to use several encrypted upload and download chunks", async () => {
    const remote = server();
    const state = envelope(reconcile(freshCheckpoint(), { [`progress/${"a".repeat(64)}`]: { kind: "progress", value: { text: "x".repeat(400000) } } }, []));
    const provider = new MegaProvider(await remote.open(), "default");
    await provider.append(state); await provider.close();
    remote.reverseTree();
    const restored = new MegaProvider(await remote.open(), "default");
    expect(await restored.read()).toEqual([state]); await restored.close();
    expect(remote.nodes.filter((node) => node.t === 1)).toHaveLength(1);
  });
  it("reads existing duplicate directories without removing them or creating another", async () => {
    const remote = server(), state = envelope(reconcile(freshCheckpoint(), {}, [])), storage = await remote.open();
    await storage.root.mkdir("KoodoReaderCustom-v1-default"); await storage.root.mkdir("KoodoReaderCustom-v1-default");
    const first = new MegaProvider(storage, "default"); await first.append(state); await first.close();
    remote.reverseTree();
    const restored = new MegaProvider(await remote.open(), "default");
    expect(await restored.read()).toEqual([state]); await restored.append(state); await restored.close();
    expect(remote.nodes.filter((node) => node.t === 1)).toHaveLength(2);
  });
  it("rejects an inconsistent file tree before any directory is created", async () => {
    const remote = server(); remote.corruptTree();
    await expect(remote.open()).rejects.toThrow("CUSTOM_MEGA_INVALID_TREE");
    expect(remote.commands.some((command) => command.a === "p")).toBe(false);
  });
  it("catches up a cached directory snapshot before retrying so it does not create another directory", async () => {
    const remote = server(true), state = envelope(reconcile(freshCheckpoint(), {}, []));
    const first = new MegaProvider(await remote.open(), "default");
    await first.append(state); await first.close();
    const second = new MegaProvider(await remote.open(), "default");
    expect(await second.read()).toEqual([state]);
    await second.append(state); await second.close();
    expect(remote.nodes.filter((node) => node.t === 1)).toHaveLength(1);
    expect(remote.nodes.filter((node) => node.t === 0)).toHaveLength(1);
  });
});
