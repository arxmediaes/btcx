const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const m={exports:{}},context={module:m,exports:m.exports,window:{},Error};vm.runInNewContext(ts.transpile(fs.readFileSync('lib/profit-widget.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),context);
(async()=>{
 assert.equal(m.exports.profitWidgetApi(),undefined);assert.equal(m.exports.profitWidgetOpen(),false);await assert.rejects(()=>m.exports.openProfitWidget(),/vista ampliada/);
 const child={closed:false};let options;context.window.documentPictureInPicture={window:child,requestWindow:async value=>{options=value;return child}};
 assert.equal(m.exports.profitWidgetOpen(),true);assert.equal(await m.exports.openProfitWidget(),child);assert.equal(options.width,320);assert.equal(options.height,300);child.closed=true;assert.equal(m.exports.profitWidgetOpen(),false);
 const page=fs.readFileSync('app/page.tsx','utf8');assert.ok(page.includes("document.visibilityState==='hidden'&&!profitWidgetOpen()"));
 console.log('PASS: unsupported browser reports enlarged-view fallback; supported PiP opens requested dimensions, tracks closed window; independent P&L reads remain enabled while widget is open. Mock browser API only.');
})().catch(e=>{console.error(e);process.exitCode=1});
