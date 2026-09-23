#!/usr/bin/env node
// Prepare or verify a lossless compatibility copy from restorable SQLite backups.
// Does not connect to production. Never copies Giving, users, or QuickBooks tokens.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {FINANCE_TABLES} from '../src/finance-storage.js';
import {sqlLiteral} from '../apps/finance/migration/copy-and-verify.js';

export function accountingManifest(db) {
 return [...FINANCE_TABLES].sort().map(table=>{
  const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name).sort();
  if(!columns.length)throw Error(`Missing table: ${table}`);
  const rows=db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all();
  const canonical=rows.map(row=>JSON.stringify(columns.map(key=>row[key]))).sort();
  return {table,columns,count:rows.length,sha256:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')};
 });
}
export function prepareAccountingCopy(source,target) {
 const expected=accountingManifest(source),destination=accountingManifest(target);
 const sql=[];
 for(const table of expected){
  const dest=destination.find(t=>t.table===table.table);
  if(dest.count!==0)throw Error(`Destination is not empty: ${table.table}`);
  if(JSON.stringify(dest.columns)!==JSON.stringify(table.columns))throw Error(`Column mismatch: ${table.table}`);
  const rows=source.prepare(`SELECT ${table.columns.join(',')} FROM ${table.table}`).all();
  for(const row of rows)sql.push(`INSERT INTO ${table.table} (${table.columns.join(',')}) VALUES (${table.columns.map(c=>sqlLiteral(row[c])).join(',')});`);
 }
 return {sql:sql.join('\n')+'\n',manifest:expected};
}
export function verifyAccountingCopy(source,target){
 const expected=accountingManifest(source),actual=accountingManifest(target);
 return {ok:JSON.stringify(expected)===JSON.stringify(actual),source:expected,target:actual};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,sourcePath,targetPath,output]=process.argv.slice(2);
 if(!['prepare','verify'].includes(mode)||!sourcePath||!targetPath||!output)throw Error('Usage: finance-accounting-copy.mjs prepare|verify source.sqlite target.sqlite output');
 const source=new DatabaseSync(sourcePath,{readOnly:true}),target=new DatabaseSync(targetPath,{readOnly:true});
 if(mode==='prepare'){
  const result=prepareAccountingCopy(source,target);
  writeFileSync(output,result.sql,{mode:0o600});writeFileSync(output+'.manifest.json',JSON.stringify(result.manifest,null,2),{mode:0o600});
  console.log(`Prepared ${result.manifest.reduce((n,t)=>n+t.count,0)} records in ${result.manifest.length} tables; no live database changed.`);
 }else{
  const result=verifyAccountingCopy(source,target);writeFileSync(output,JSON.stringify(result,null,2),{mode:0o600});
  console.log(`Full-row reconciliation: ${result.ok?'PASS':'FAIL'}`);if(!result.ok)process.exitCode=1;
 }
 source.close();target.close();
}
