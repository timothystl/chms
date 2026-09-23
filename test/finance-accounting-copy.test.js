import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {FINANCE_TABLES} from '../src/finance-storage.js';
import {prepareAccountingCopy,verifyAccountingCopy} from '../scripts/finance-accounting-copy.mjs';
function db(){const d=new DatabaseSync(':memory:');for(const t of FINANCE_TABLES)d.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,value TEXT,cents INTEGER)`);return d;}
it('preserves exact values, provenance, IDs, and sensitive settings without translation',()=>{
 const source=db(),target=db();
 source.prepare('INSERT INTO finance_settings VALUES(?,?,?)').run(1,JSON.stringify({name:"O'Brien",draft:'unchanged'}),-125);
 source.prepare('INSERT INTO finance_church_entries VALUES(?,?,?)').run(7,'qbo_sync',12345678);
 const result=prepareAccountingCopy(source,target);target.exec(result.sql);
 expect(verifyAccountingCopy(source,target).ok).toBe(true);
 target.exec('UPDATE finance_church_entries SET cents=cents+1');expect(verifyAccountingCopy(source,target).ok).toBe(false);
});
it('refuses overwriting an occupied destination or dropping a source column',()=>{
 const source=db(),target=db();target.exec("INSERT INTO finance_settings VALUES(1,'existing',1)");
 expect(()=>prepareAccountingCopy(source,target)).toThrow(/not empty/);
 const empty=db();source.exec('ALTER TABLE finance_settings ADD COLUMN extra TEXT');
 expect(()=>prepareAccountingCopy(source,empty)).toThrow(/Column mismatch/);
});
