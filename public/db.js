// Casos guardados no próprio aparelho (IndexedDB), com as fotos.
const DB = "encarregado";
const STORE = "cases";

let dbp;
function open() {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  });
}

export const allCases = () => tx("readonly", (s) => s.getAll());
export const putCase = (c) => tx("readwrite", (s) => s.put(c));
export const deleteCase = (id) => tx("readwrite", (s) => s.delete(id));

export function newCase() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), createdAt: now, updatedAt: now,
    what: "", room: "Cozinha", area: "", photoBefore: null, photoAfter: null,
    diag: null, list: null, owned: {}, chat: [], after: null, afterNotes: "",
    never: null, checks: {}, quote: null, quoteAmount: "", landlord: "", llName: "", myName: "",
  };
}
