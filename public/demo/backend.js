/* =========================================================
   demo/backend.js — a stand-in for the Firebase SDK, used only by the
   public demo (demo/index.html).

   It provides the small part of the Firebase "compat" API that the app
   uses (see data/firebase.js, data/api.js, data/sync.js) and keeps every
   document in this browser tab's memory. Nothing is sent anywhere and
   nothing is saved: reloading the page starts the demo over.

   The demo page also has its own Content-Security-Policy that only lets
   it load and connect to this site, so it couldn't reach the real
   Firebase project even if it tried.
========================================================= */

/* ---------------- VALUES ---------------- */

export class Timestamp {
  constructor(ms){ this._ms = ms; }
  static now(){ return new Timestamp(Date.now()); }
  static fromDate(d){ return new Timestamp(d.getTime()); }
  toDate(){ return new Date(this._ms); }
  toMillis(){ return this._ms; }
  get seconds(){ return Math.floor(this._ms / 1000); }
}

const SERVER_TIME = Object.freeze({ sentinel: 'serverTimestamp' });
const DELETE = Object.freeze({ sentinel: 'delete' });

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp);

function clone(v){
  if(Array.isArray(v)) return v.map(clone);
  if(isPlainObject(v)){ const o = {}; for(const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  return v;
}

/** Replaces server-time markers with "now" and drops delete markers. */
function resolve(v, now){
  if(v === SERVER_TIME) return now;
  if(Array.isArray(v)) return v.map(x => resolve(x, now));
  if(isPlainObject(v)){
    const o = {};
    for(const k of Object.keys(v)) if(v[k] !== DELETE) o[k] = resolve(v[k], now);
    return o;
  }
  return v;
}

function deepMerge(target, patch, now){
  for(const k of Object.keys(patch)){
    const v = patch[k];
    if(v === DELETE) delete target[k];
    else if(isPlainObject(v) && v !== SERVER_TIME && isPlainObject(target[k])) deepMerge(target[k], v, now);
    else target[k] = resolve(v, now);
  }
  return target;
}

/** update({'dod.tests': true}) style dotted field paths. */
function setFieldPath(obj, path, value, now){
  const keys = path.split('.');
  let o = obj;
  for(const k of keys.slice(0, -1)){
    if(!isPlainObject(o[k])) o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if(value === DELETE) delete o[last];
  else o[last] = resolve(value, now);
}

const getField = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const sortable = (v) => (v instanceof Timestamp ? v.toMillis() : v);

function compareValues(a, b){
  a = sortable(a); b = sortable(b);
  if(a == null && b == null) return 0;
  if(a == null) return -1;
  if(b == null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function demoError(code, message){
  const e = new Error(message);
  e.code = code;
  return e;
}

const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const autoId = () => Array.from({ length: 20 }, () => AUTO_ID_CHARS[Math.floor(Math.random() * AUTO_ID_CHARS.length)]).join('');
const parentPath = (path) => path.split('/').slice(0, -1).join('/');
const later = (fn) => setTimeout(fn, 0);

/* ---------------- STORE ---------------- */

const docs = new Map();          // "projects/web/tickets/t1" → data
const listeners = new Set();     // live onSnapshot subscriptions

/** Applies a list of writes all-or-nothing, then tells the listeners. */
function applyWrites(ops){
  for(const op of ops){
    if(op.type === 'update' && !docs.has(op.path)) throw demoError('not-found', `No document to update: ${op.path}`);
  }
  const now = Timestamp.now();
  for(const op of ops){
    if(op.type === 'delete') docs.delete(op.path);
    else if(op.type === 'set'){
      docs.set(op.path, op.merge && docs.has(op.path) ? deepMerge(docs.get(op.path), op.data, now) : resolve(op.data, now));
    }else if(op.type === 'update'){
      const data = docs.get(op.path);
      for(const k of Object.keys(op.data)) setFieldPath(data, k, op.data[k], now);
    }
  }
  notify();
}

function notify(){
  listeners.forEach(l => later(() => l.check()));
}

/** Seeds a document directly (used by demo/seed.js before the app starts). */
export function put(path, data){
  docs.set(path, clone(data));
}

/* ---------------- SNAPSHOTS ---------------- */

class DocumentSnapshot {
  constructor(ref, data){
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this._data = data;
  }
  data(){ return this._data === undefined ? undefined : clone(this._data); }
  get(field){ return clone(getField(this._data || {}, field)); }
}

class QuerySnapshot {
  constructor(docSnaps){
    this.docs = docSnaps;
    this.size = docSnaps.length;
    this.empty = docSnaps.length === 0;
  }
  forEach(fn){ this.docs.forEach(fn); }
}

/** A stable fingerprint, so listeners only fire when their result really changed. */
const fingerprint = (value) => JSON.stringify(value, (k, v) => (v instanceof Timestamp ? { t: v.toMillis() } : v));

function subscribe(read, next, error){
  const sub = {
    last: null,
    check(){
      if(!listeners.has(sub)) return;
      let snap;
      try{ snap = read(); }catch(e){ if(error) error(e); return; }
      const fp = fingerprint(snap instanceof QuerySnapshot ? snap.docs.map(d => [d.id, d._data]) : [snap.exists, snap._data]);
      if(fp === sub.last) return;
      sub.last = fp;
      next(snap);
    }
  };
  listeners.add(sub);
  later(() => sub.check());
  return () => listeners.delete(sub);
}

/* ---------------- REFERENCES & QUERIES ---------------- */

class Query {
  constructor(path, filters = [], order = [], max = null){
    this.path = path;
    this._filters = filters;
    this._order = order;
    this._max = max;
  }
  where(field, op, value){ return new Query(this.path, [...this._filters, { field, op, value }], this._order, this._max); }
  orderBy(field, dir = 'asc'){ return new Query(this.path, this._filters, [...this._order, { field, dir }], this._max); }
  limit(n){ return new Query(this.path, this._filters, this._order, n); }

  _run(){
    let rows = [];
    for(const [path, data] of docs){
      if(parentPath(path) === this.path) rows.push(new DocumentSnapshot(new DocumentReference(path), data));
    }
    for(const { field, op, value } of this._filters){
      rows = rows.filter(d => {
        const v = getField(d._data, field);
        if(op === '==') return v === value;
        if(op === '!=') return v !== value;
        if(op === 'array-contains') return Array.isArray(v) && v.includes(value);
        if(op === 'in') return value.includes(v);
        throw demoError('unimplemented', `The demo doesn't support "${op}" queries`);
      });
    }
    if(this._order.length){
      rows.sort((a, b) => {
        for(const { field, dir } of this._order){
          const c = compareValues(getField(a._data, field), getField(b._data, field));
          if(c) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    if(this._max != null) rows = rows.slice(0, this._max);
    return new QuerySnapshot(rows);
  }

  get(){ return Promise.resolve(this._run()); }
  onSnapshot(next, error){ return subscribe(() => this._run(), next, error); }
}

class CollectionReference extends Query {
  constructor(path){
    super(path);
    this.id = path.split('/').pop();
  }
  doc(id){ return new DocumentReference(`${this.path}/${id || autoId()}`); }
  async add(data){
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

class DocumentReference {
  constructor(path){
    this.path = path;
    this.id = path.split('/').pop();
  }
  get parent(){ return new CollectionReference(parentPath(this.path)); }
  collection(name){ return new CollectionReference(`${this.path}/${name}`); }
  _read(){ return new DocumentSnapshot(this, docs.get(this.path)); }
  get(){ return Promise.resolve(this._read()); }
  async set(data, options = {}){ applyWrites([{ type: 'set', path: this.path, data, merge: !!options.merge }]); }
  async update(data){ applyWrites([{ type: 'update', path: this.path, data }]); }
  async delete(){ applyWrites([{ type: 'delete', path: this.path }]); }
  onSnapshot(next, error){ return subscribe(() => this._read(), next, error); }
}

class WriteBatch {
  constructor(){ this._ops = []; }
  set(ref, data, options = {}){ this._ops.push({ type: 'set', path: ref.path, data, merge: !!options.merge }); return this; }
  update(ref, data){ this._ops.push({ type: 'update', path: ref.path, data }); return this; }
  delete(ref){ this._ops.push({ type: 'delete', path: ref.path }); return this; }
  async commit(){ applyWrites(this._ops); }
}

const db = {
  collection: (path) => new CollectionReference(path),
  doc: (path) => new DocumentReference(path),
  batch: () => new WriteBatch(),
  async runTransaction(fn){
    const tx = new WriteBatch();
    tx.get = async (ref) => ref._read();
    const result = await fn(tx);
    applyWrites(tx._ops);
    return result;
  },
  useEmulator(){}
};

/* ---------------- AUTH ---------------- */

const NOT_IN_DEMO = 'Not available in the demo. Use "Viewing as" at the top of the page to switch person.';
const authListeners = new Set();
let currentUser = null;

function makeUser(email){
  const unavailable = async () => { throw demoError('demo/unavailable', NOT_IN_DEMO); };
  return {
    uid: email, email, emailVerified: true, displayName: null,
    reload: async () => {}, getIdToken: async () => 'demo', sendEmailVerification: async () => {},
    reauthenticateWithCredential: unavailable, updatePassword: unavailable
  };
}

const auth = {
  get currentUser(){ return currentUser; },
  onAuthStateChanged(cb){
    authListeners.add(cb);
    later(() => cb(currentUser));
    return () => authListeners.delete(cb);
  },
  signInWithEmailAndPassword: async () => { throw demoError('demo/unavailable', NOT_IN_DEMO); },
  createUserWithEmailAndPassword: async () => { throw demoError('demo/unavailable', NOT_IN_DEMO); },
  sendPasswordResetEmail: async () => { throw demoError('demo/unavailable', NOT_IN_DEMO); },
  // "Sign out" starts the demo over.
  signOut: async () => { location.reload(); },
  useEmulator(){}
};

/** Signs the demo in as someone else (the "Viewing as" menu). */
export function signInAs(email){
  currentUser = makeUser(email);
  authListeners.forEach(cb => cb(currentUser));
}

/* ---------------- THE GLOBAL ---------------- */

/** Installs `window.firebase`, which data/firebase.js picks up instead of the real SDK. */
export function installDemoFirebase(){
  window.firebase = {
    initializeApp: () => ({}),
    appCheck: () => ({ activate(){} }),
    auth: Object.assign(() => auth, { EmailAuthProvider: { credential: () => ({}) } }),
    firestore: Object.assign(() => db, {
      FieldValue: { serverTimestamp: () => SERVER_TIME, delete: () => DELETE },
      Timestamp
    })
  };
}
