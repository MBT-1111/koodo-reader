// Shared synthetic encrypted MEGA server for unit and isolated Android tests.
const { Storage } = require("megajs");
// Exercise the installed SDK's encryption, node-tree reconstruction and transfer
// streams against a local in-memory server, without real accounts or credentials.
const server = (cached = false) => {
    const nodes = [{ h: "root0000", t: 2, ts: 0 }];
    const uploads = new Map(), contents = new Map();
    const commands = [];
    const changes = [];
    let uploadFailure = false, downloadFailure = false, reverseTree = false, corruptTree = false;
    const fetch = async (input, options) => {
        const url = new URL(String(input));
        if (url.pathname === "/sc") {
            const index = Number((url.searchParams.get("sn") || "sequence0").slice(8));
            return new Response(JSON.stringify(index < changes.length ? { a: changes.slice(index), sn: `sequence${changes.length}` } : { w: "https://synthetic.invalid/wait" }));
        }
        if (url.hostname === "upload.invalid") {
            if (uploadFailure)
                throw new Error("Synthetic upload failure");
            const [, id, offset] = url.pathname.split("/"), start = Number(offset);
            const upload = uploads.get(id), bytes = Buffer.from(options?.body);
            bytes.copy(upload.bytes, start);
            if (!upload.chunks.has(start)) {
                upload.chunks.add(start);
                upload.received += bytes.length;
            }
            return new Response(new Uint8Array(upload.received === upload.bytes.length ? Buffer.from(id) : []));
        }
        if (url.hostname === "download.invalid") {
            if (downloadFailure)
                return new Response(new ReadableStream({ start: (controller) => controller.error(new Error("Synthetic response-body failure")) }));
            const [, id, range] = url.pathname.split("/");
            const [start, end] = range.split("-").map(Number);
            return new Response(new Uint8Array(contents.get(id).subarray(start, end + 1)));
        }
        const command = JSON.parse(String(options?.body))[0];
        commands.push(command);
        let result;
        if (command.a === "f")
            result = { ok: [], sn: `sequence${cached ? 0 : changes.length}`, f: corruptTree ? [...nodes, { h: "cycle001", p: "cycle002", t: 1 }, { h: "cycle002", p: "cycle001", t: 1 }] : cached ? [nodes[0]] : reverseTree ? [...nodes].reverse() : nodes };
        else if (command.a === "u") {
            const id = `transfer${uploads.size}`;
            uploads.set(id, { bytes: Buffer.alloc(command.s), chunks: new Set(), received: 0 });
            result = { p: `https://upload.invalid/${id}` };
        }
        else if (command.a === "p" && Array.isArray(command.n)) {
            const item = command.n[0], id = `node${String(nodes.length).padStart(4, "0")}`;
            const bytes = item.t === 0 ? uploads.get(Buffer.from(item.h, "base64url").toString()).bytes : undefined;
            const node = { h: id, t: item.t, p: command.t, a: item.a, k: `fixture:${item.k}`, s: bytes?.length, ts: 0 };
            nodes.push(node);
            if (bytes)
                contents.set(id, bytes);
            changes.push({ a: "t", t: { f: [node] } });
            result = { f: [node] };
        }
        else if (command.a === "g" && typeof command.n === "string")
            result = { g: `https://download.invalid/${command.n}`, s: contents.get(command.n).length };
        else
            throw new Error(`Unexpected synthetic MEGA command: ${command.a}`);
        return new Response(JSON.stringify([result]));
    };
    const open = async () => {
        const { prepareMegaStorage, catchUpMegaStorage } = await Promise.resolve().then(() => require("../../src/utils/main/custom/megaTransport.mjs"));
        const storage = prepareMegaStorage(Storage.fromJSON({ key: Buffer.alloc(16, 1).toString("base64url"), sid: "synthetic-session", name: "Fixture", user: "fixture", options: { email: "fixture@example.invalid", password: "", keepalive: false, fetch: fetch } }));
        await storage.ready;
        await storage.reload(true);
        await catchUpMegaStorage(storage);
        return storage;
    };
    return { nodes, commands, open, fetch, staleDeletion: () => { changes.push({ a: "d", n: "alreadygone" }); }, failUpload: (value) => { uploadFailure = value; }, failDownload: (value) => { downloadFailure = value; }, reverseTree: () => { reverseTree = true; }, corruptTree: () => { corruptTree = true; } };
};

module.exports = { server };
