import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { envelope, freshCheckpoint, reconcile } from "./protocol";

const require = createRequire(import.meta.url);
const { Storage } = require("megajs") as typeof import("megajs");
const { MegaProvider, prepareMegaStorage, catchUpMegaStorage } = require("../../utils/main/custom/providers.js") as typeof import("../../utils/main/custom/providers.js");
type MegaFetch = NonNullable<ConstructorParameters<typeof Storage>[0]["fetch"]>;

interface RemoteNode { h: string; t: number; p?: string; a?: string; k?: string; s?: number; ts: number }
interface Command { a: string; t?: string; n?: string | { t: number; a: string; k: string; h: string }[]; s?: number; ssl?: number }
// Exercise the installed SDK's encryption, node-tree reconstruction and transfer
// streams against a local in-memory server, without real accounts or credentials.
const server = (cached = false) => {
  const nodes: RemoteNode[] = [{ h: "root0000", t: 2, ts: 0 }];
  const uploads = new Map<string, { bytes: Buffer; chunks: Set<number>; received: number }>(), contents = new Map<string, Buffer>();
  const commands: Command[] = [];
  const changes: { a: string; t: { f: RemoteNode[] } }[] = [];
  let uploadFailure = false, downloadFailure = false, reverseTree = false, corruptTree = false;
  const fetch: typeof globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname === "/sc") {
      const index = Number((url.searchParams.get("sn") || "sequence0").slice(8));
      return new Response(JSON.stringify(index < changes.length ? { a: changes.slice(index), sn: `sequence${changes.length}` } : { w: "https://synthetic.invalid/wait" }));
    }
    if (url.hostname === "upload.invalid") {
      if (uploadFailure) throw new Error("Synthetic upload failure");
      const [, id, offset] = url.pathname.split("/"), start = Number(offset);
      const upload = uploads.get(id)!, bytes = Buffer.from(options?.body as Uint8Array);
      bytes.copy(upload.bytes, start);
      if (!upload.chunks.has(start)) { upload.chunks.add(start); upload.received += bytes.length; }
      return new Response(new Uint8Array(upload.received === upload.bytes.length ? Buffer.from(id) : []));
    }
    if (url.hostname === "download.invalid") {
      if (downloadFailure) return new Response(new ReadableStream({ start: (controller) => controller.error(new Error("Synthetic response-body failure")) }));
      const [, id, range] = url.pathname.split("/");
      const [start, end] = range.split("-").map(Number);
      return new Response(new Uint8Array(contents.get(id)!.subarray(start, end + 1)));
    }
    const command = (JSON.parse(String(options?.body)) as Command[])[0]; commands.push(command);
    let result: unknown;
    if (command.a === "f") result = { ok: [], sn: `sequence${cached ? 0 : changes.length}`, f: corruptTree ? [...nodes, { h: "cycle001", p: "cycle002", t: 1 }, { h: "cycle002", p: "cycle001", t: 1 }] : cached ? [nodes[0]] : reverseTree ? [...nodes].reverse() : nodes };
    else if (command.a === "u") {
      const id = `transfer${uploads.size}`;
      uploads.set(id, { bytes: Buffer.alloc(command.s!), chunks: new Set(), received: 0 });
      result = { p: `https://upload.invalid/${id}` };
    } else if (command.a === "p" && Array.isArray(command.n)) {
      const item = command.n[0], id = `node${String(nodes.length).padStart(4, "0")}`;
      const bytes = item.t === 0 ? uploads.get(Buffer.from(item.h, "base64url").toString())!.bytes : undefined;
      const node: RemoteNode = { h: id, t: item.t, p: command.t, a: item.a, k: `fixture:${item.k}`, s: bytes?.length, ts: 0 };
      nodes.push(node); if (bytes) contents.set(id, bytes);
      changes.push({ a: "t", t: { f: [node] } });
      result = { f: [node] };
    } else if (command.a === "g" && typeof command.n === "string") result = { g: `https://download.invalid/${command.n}`, s: contents.get(command.n)!.length };
    else throw new Error(`Unexpected synthetic MEGA command: ${command.a}`);
    return new Response(JSON.stringify([result]));
  };
  const open = async () => {
    const storage = prepareMegaStorage(Storage.fromJSON({ key: Buffer.alloc(16, 1).toString("base64url"), sid: "synthetic-session", name: "Fixture", user: "fixture", options: { email: "fixture@example.invalid", password: "", keepalive: false, fetch: fetch as unknown as MegaFetch } }));
    await storage.ready; await storage.reload(true); await catchUpMegaStorage(storage);
    return storage;
  };
  return { nodes, commands, open, failUpload: (value: boolean) => { uploadFailure = value; }, failDownload: (value: boolean) => { downloadFailure = value; }, reverseTree: () => { reverseTree = true; }, corruptTree: () => { corruptTree = true; } };
};

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
