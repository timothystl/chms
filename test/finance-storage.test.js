import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {financeStorageDb,accountingQuery} from '../src/finance-storage.js';
function database(){
 const raw=new DatabaseSync(':memory:');
 raw.exec('CREATE TABLE finance_settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE app_users(username TEXT); CREATE TABLE finance_qb_connection(id INTEGER);');
 function statement(sql,args=[]){return {bind:(...a)=>statement(sql,a),async first(){return raw.prepare(sql).get(...args)||null},async all(){return {results:raw.prepare(sql).all(...args)}},async run(){return raw.prepare(sql).run(...args)}};}
 return {raw,prepare:statement,async batch(items){raw.exec('BEGIN');try{const out=[];for(const s of items)out.push(await s.run());raw.exec('COMMIT');return out;}catch(e){raw.exec('ROLLBACK');throw e}}};
}
it('switches accounting reads and writes together, retaining identity and QuickBooks owners',async()=>{
 const DB=database(),FINANCE_DB=database();
 DB.raw.exec("INSERT INTO finance_settings VALUES('x','old'); INSERT INTO app_users VALUES('office'); INSERT INTO finance_qb_connection VALUES(1)");
 FINANCE_DB.raw.exec("INSERT INTO finance_settings VALUES('x','new')");
 const env={DB,FINANCE_DB,FINANCE_STORAGE_MODE:'finance'},db=financeStorageDb(env);
 expect(financeStorageDb({...env})).toBe(db);
 expect((await db.prepare("SELECT value FROM finance_settings WHERE key=?").bind('x').first()).value).toBe('new');
 expect((await db.prepare('SELECT username FROM app_users').first()).username).toBe('office');
 expect((await db.prepare('SELECT id FROM finance_qb_connection').first()).id).toBe(1);
 await db.batch([db.prepare('UPDATE finance_settings SET value=? WHERE key=?').bind('saved','x')]);
 expect(FINANCE_DB.raw.prepare("SELECT value FROM finance_settings").get().value).toBe('saved');
 expect(DB.raw.prepare("SELECT value FROM finance_settings").get().value).toBe('old');
});
it('freeze allows source reads and refuses every accounting mutation before execution',async()=>{
 const DB=database();DB.raw.exec("INSERT INTO finance_settings VALUES('x','old')");const db=financeStorageDb({DB,FINANCE_STORAGE_MODE:'copying'});
 expect((await db.prepare('SELECT value FROM finance_settings').first()).value).toBe('old');
 for(const sql of ["UPDATE finance_settings SET value='new'","INSERT INTO finance_settings VALUES('y','new')","DELETE FROM finance_settings","WITH x AS (SELECT 1) DELETE FROM finance_settings"]){expect(()=>db.prepare(sql)).toThrow(/maintenance/)}
 expect(DB.raw.prepare('SELECT COUNT(*) AS n FROM finance_settings').get().n).toBe(1);
});
it('never silently falls back if the Finance binding is absent',()=>{expect(()=>financeStorageDb({DB:database(),FINANCE_STORAGE_MODE:'finance'})).toThrow(/binding missing/)});
it('does not misroute strings or comments and rejects cross-owner joins and batches',async()=>{
 expect(accountingQuery("SELECT 'FROM finance_settings' FROM app_users -- JOIN finance_budget_plan").finance).toBe(false);
 expect(()=>accountingQuery('SELECT * FROM finance_settings JOIN app_users')).toThrow(/crosses/);
 const db=financeStorageDb({DB:database(),FINANCE_DB:database(),FINANCE_STORAGE_MODE:'finance'});
 expect(()=>db.batch([db.prepare("INSERT INTO finance_settings VALUES('x','x')"),db.prepare("INSERT INTO app_users VALUES('x')")])).toThrow(/crosses/);
});
it('preserves the original handle before cutover',()=>{const DB=database();expect(financeStorageDb({DB})).toBe(DB)});
