import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
registerHooks({
 resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&context.parentURL){for(const ext of ['.ts','.tsx','/index.ts']){const url=new URL(specifier+ext,context.parentURL);if(existsSync(url))return {url:url.href,shortCircuit:true}}}throw error}},
 load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};if(url.endsWith('.ts')||url.endsWith('.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{fileName:new URL(url).pathname,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,shortCircuit:true};return next(url,context)},
});
