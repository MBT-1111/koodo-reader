const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { randomBytes } = require("node:crypto");
const { _android: android } = require("playwright");
const output = path.resolve(__dirname, "../dist/android-device");
const pkg = "xyz.koodoreader.custom.android";

// This bundle never changes the saved account, namespace or application data.
const entry = `
import { androidSyncConnection, withAndroidMega } from '../../src/custom/android/mega';
import { MegaProvider, documentName } from '../../src/utils/main/custom/megaTransport.mjs';
import { freshCheckpoint, envelope, stable, materialize, mergeDocuments } from '../../src/custom/sync/protocol';
import { prepareSync, finishSync } from '../../src/custom/sync/workflow';
import { nativeCommand } from '../../src/custom/android/storage';
import { Storage } from 'megajs';
import { prepareMegaStorage, closeStorage, catchUpMegaStorage } from '../../src/utils/main/custom/megaTransport.mjs';
export async function diagnose() {
  let storage;
  try {
    const saved=JSON.parse(await nativeCommand({channel:'credential',slot:'mega',action:'read'}));
    storage=prepareMegaStorage(Storage.fromJSON({...saved.session,options:{...saved.session.options,keepalive:false}}));
    storage.on('error',()=>{});
    await storage.ready; await storage.reload(true);
    const fetcher=storage.api.fetch.bind(storage.api); window.koodoMegaDiagnostic={connected:true};
    storage.api.fetch=async (...args)=>{const response=await fetcher(...args); if(new URL(String(args[0])).pathname.endsWith('/sc')) {const packet=await response.clone().json();window.koodoMegaDiagnostic={connected:true,status:response.status,packet:typeof packet==='number'?packet:typeof packet,hasWait:typeof packet?.w==='string',hasSequence:typeof packet?.sn==='string'};}return response;};
    await catchUpMegaStorage(storage);
    return {...window.koodoMegaDiagnostic,caughtUp:true};
  } catch(error) { return {...window.koodoMegaDiagnostic,type:error.name,reason:String(error.message).split('\\n')[0].replace(/https?:\\/\\/\\S+/g,'[url]').replace(/[A-Za-z0-9_+=/-]{24,}/g,'[redacted]')}; }
  finally { if(storage) await closeStorage(storage); }
}
export async function validate(namespace) {
  window.koodoMegaStage='connection';
  if (!/^codex-qa-\\d+-[a-f0-9]{8}$/.test(namespace)) throw new Error('CUSTOM_TEST_NAMESPACE');
  const connection = await androidSyncConnection();
  if (!connection || connection.namespace === namespace) throw new Error('CUSTOM_TEST_NAMESPACE');
  return withAndroidMega(connection, async original => {
    window.koodoMegaStage='read-real-space';
    const before = stable(await original.read());
    const qa = new MegaProvider(original.storage, namespace), owned = new Set();
    if ((await qa.folders()).length) throw new Error('CUSTOM_TEST_ALREADY_EXISTS');
    window.koodoMegaStage='isolated-fixtures';
    const make = (prefix, count) => {
      const books = Array.from({length:count}, (_, i) => ({key:prefix+i,name:'Synthetic '+i,format:'TXT'}));
      return { raw:{tables:{books,notes:[],bookmarks:[]},config:{readingTime:JSON.stringify(Object.fromEntries(books.map(b=>[b.key,100])))}}, hashes:Object.fromEntries(books.map((b,i)=>[b.key,String(i+1).repeat(64)])), state:freshCheckpoint() };
    };
    const step = async client => {
      const docs = await qa.read(), job = prepareSync(client.raw,client.hashes,client.state,docs);
      if (job.publish) { const doc=envelope(job.state); owned.add(documentName(doc,JSON.stringify(doc))); await qa.append(doc); }
      client.raw=job.next; client.state=job.state; return {...finishSync(client.state,client.raw),unchanged:!job.publish};
    };
    const result = {realSpaceUnchanged:false,isolatedRoundTrip:false,partialLibrary:false,repeatedSyncUnchanged:false,qaRemoved:false};
    try {
      const desktop=make('desktop-',3), phone=make('phone-',2);
      desktop.raw.tables.notes=[{key:'synthetic-note',bookKey:'desktop-2',text:'Synthetic pending note'}];
      await step(desktop); await step(phone);
      if(phone.raw.tables.books.length!==2 || phone.raw.tables.notes.length!==0) throw new Error('CUSTOM_TEST_PARTIAL_LIBRARY');
      phone.raw.config.readingTime=JSON.stringify({'phone-0':110,'phone-1':100});
      await step(phone); await step(desktop); await step(phone);
      const total=JSON.parse(desktop.raw.config.readingTime);
      if(total['desktop-0']!==110 || total['desktop-1']!==100 || total['desktop-2']!==100 || desktop.raw.tables.notes.length!==1) throw new Error('CUSTOM_TEST_MERGE');
      const cloud=materialize(mergeDocuments(await qa.read()));
      if(Object.keys(cloud).filter(k=>k.startsWith('book/')).length!==3 || Object.keys(cloud).some(k=>k.startsWith('trash/'))) throw new Error('CUSTOM_TEST_PARTIAL_LIBRARY');
      result.isolatedRoundTrip=true; result.partialLibrary=true;
      result.repeatedSyncUnchanged=(await step(phone)).unchanged;
      if(!result.repeatedSyncUnchanged) throw new Error('CUSTOM_TEST_DUPLICATE');
    } finally {
      window.koodoMegaStage='cleanup';
      // Delete only a newly created folder whose every file belongs to this run.
      for(const folder of await qa.folders()) {
        if(folder.name!=='KoodoReaderCustom-v1-'+namespace || (folder.children||[]).some(file=>file.directory||!owned.has(file.name))) throw new Error('CUSTOM_TEST_PRESERVE_UNKNOWN_FILES');
        await folder.delete(true);
      }
      await qa.storage.reload(true); await catchUpMegaStorage(qa.storage);
      result.qaRemoved=(await qa.folders()).length===0;
      result.realSpaceUnchanged=stable(await original.read())===before;
      if(!result.qaRemoved || !result.realSpaceUnchanged) throw new Error('CUSTOM_TEST_FINAL_AUDIT');
    }
    return result;
  });
}
export async function inspect(namespace) {
  const connection=await androidSyncConnection();
  return withAndroidMega(connection, async original=>({realDocuments:(await original.read()).length,qaFolders:(await new MegaProvider(original.storage,namespace).folders()).map(folder=>({name:folder.name,files:(folder.children||[]).map(file=>file.name)}))}));
}
`;

async function main() {
  await fs.mkdir(output, { recursive: true });
  const inspect = process.argv.includes("--inspect");
  const namespace = inspect ? JSON.parse(await fs.readFile(path.join(output, "mega-live-report.json"), "utf8")).namespace : `codex-qa-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const report = { passed: false, namespace, checks: {}, error: "" };
  if (!inspect) await fs.writeFile(path.join(output, "mega-live-report.json"), JSON.stringify(report, null, 2));
  const source = path.join(output, "mega-live-entry.mjs"); await fs.writeFile(source, entry);
  const { build } = await import("vite"), { nodePolyfills } = await import("vite-plugin-node-polyfills");
  const bundleDir = path.join(output, "mega-live-bundle");
  await build({ configFile: false, logLevel: "error", plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } })], build: {
    outDir: bundleDir, emptyOutDir: false, minify: false, lib: { entry: source, name: "KoodoMegaProbe", formats: ["iife"], fileName: () => "probe.js" },
  } });
  const devices = await android.devices({ omitDriverInstall: true });
  let page;
  try {
    const device = devices.find(item => item.serial() === process.env.ANDROID_SERIAL) || devices[0]; assert.ok(device, "Connect an unlocked test phone");
    page = await (await device.webView({ pkg })).page();
    assert.equal(await page.locator(".android-reader").count(), 0, "Keep the main app in the library");
    await page.addScriptTag({ content: await fs.readFile(path.join(bundleDir, "probe.js"), "utf8") });
    if (inspect) { console.log(JSON.stringify(await page.evaluate(() => window.KoodoMegaProbe.diagnose()))); console.log(JSON.stringify(await page.evaluate(namespace => window.KoodoMegaProbe.inspect(namespace), namespace))); return; }
    report.checks = await page.evaluate(namespace => window.KoodoMegaProbe.validate(namespace), namespace);
    assert.ok(Object.values(report.checks).every(Boolean)); report.passed = true;
    console.log("PASS real MEGA isolated round trip, partial-library merge, repeat sync, cleanup and real-space read-only audit");
  } catch (error) {
    report.error = String(error.message).match(/CUSTOM_[A-Z_]+/)?.[0] || error.name;
    report.reason = String(error.message).split("\n")[0].replace(/https?:\/\/\S+/g, "[url]").replace(/[A-Za-z0-9_+=/-]{24,}/g, "[redacted]");
    report.stage = page ? await page.evaluate(() => window.koodoMegaStage || "bundle").catch(() => "disconnected") : "attach";
    console.error(JSON.stringify({ reason: report.reason, stage: report.stage }));
    throw new Error(report.error);
  } finally {
    if (page) await page.evaluate(() => window.Capacitor.Plugins.KoodoStorage.setKeepScreenOn({ enabled: false })).catch(() => {});
    if (!inspect) await fs.writeFile(path.join(output, "mega-live-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map(device => device.close()));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
