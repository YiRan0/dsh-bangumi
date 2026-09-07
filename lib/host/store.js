/**
 * @dsh-external/dsh-bangumi — 状态仓库（SQLite 之上的一层内存镜像）。
 * 对外保持 getState()/saveState() 原 API；底层数据在 ~/.dsh/dsh-bangumi/bangumi.db。
 * 跨 fiber 一致性：每次 getState 比对 PRAGMA data_version，他人写入自动重载。
 */
import { getDb } from './db.js';
let mem = null;
let lastVersion = -1;
/** 返回当前状态（他人写入自动重载，本 fiber 改动优先于未落库镜像） */
export function getState() {
    const db = getDb();
    const ver = db.dataVersion();
    if (!mem || ver !== lastVersion) {
        mem = { subscriptions: db.listSubscriptions(), downloads: db.listDownloads() };
        lastVersion = ver;
    }
    return mem;
}
/** 把内存状态全量落库（内部事务），并刷新版本基准 */
export function saveState(state) {
    const db = getDb();
    db.replaceAll(state);
    mem = state;
    lastVersion = db.dataVersion();
}
export { DB_DIR, DB_PATH } from './db.js';
//# sourceMappingURL=store.js.map