const BASE = 'https://api.bgm.tv';
async function apiGet(path) {
    const { netFetch } = await import('./net.js');
    const res = await netFetch(BASE + path, {
        timeoutMs: 15000,
        headers: { 'User-Agent': 'dsh-bangumi/0.1 (+https://github.com/dsh-external/dsh-bangumi)' },
    });
    if (!res.ok)
        throw new Error('bangumi ' + res.status + ' ' + res.statusText);
    return res.json();
}
function toSubject(raw) {
    const infobox = raw.infobox ?? [];
    const aliases = new Set();
    for (const row of infobox) {
        if (row.key === '别名') {
            const values = Array.isArray(row.value) ? row.value : [row.value];
            for (const v of values) {
                const text = typeof v === 'string' ? v : typeof v === 'object' && v ? (v.v ?? v.k ?? '') : '';
                if (typeof text === 'string' && text.trim())
                    aliases.add(text.trim());
            }
        }
    }
    for (const n of [raw.name, raw.name_cn].filter(Boolean))
        aliases.add(String(n));
    return {
        id: raw.id,
        name: raw.name ?? '',
        nameCn: raw.name_cn ?? '',
        // /v0/subjects 用 date 字段，/v0/search 结果同；air_date 是旧字段堡垒
        airDate: (raw.date || (raw.air_date && raw.air_date !== '0000-00-00' ? raw.air_date : '') || undefined),
        // 详情(v0/subjects)响应有 total_episodes（本篇+特典总数，bgm 权威）；搜索(v0/search)响应通常只有 eps。
        // 二者都缺或为 0 时保持 undefined（调用方再以 episodes 表长度兜底）。
        totalEpisodes: typeof raw.total_episodes === 'number' && raw.total_episodes > 0
            ? raw.total_episodes
            : typeof raw.eps === 'number' && raw.eps > 0 ? raw.eps : undefined,
        images: raw.images ?? undefined,
        summary: raw.summary ?? undefined,
        platform: typeof raw.platform === 'string' ? raw.platform : undefined,
        tags: Array.isArray(raw.tags) ? raw.tags.map((tg) => (typeof tg === 'string' ? tg : tg?.name)).filter(Boolean).slice(0, 8) : undefined,
        aliases: [...aliases],
    };
}
/** 番剧搜索：POST /search/subjects，type=2（动画） */
export async function searchSubjects(keyword, limit = 10) {
    const { netFetch } = await import('./net.js');
    const res = await netFetch(BASE + '/v0/search/subjects?limit=' + limit, {
        method: 'POST',
        timeoutMs: 20000,
        headers: {
            'User-Agent': 'dsh-bangumi/0.1 (+https://github.com/dsh-external/dsh-bangumi)',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword, filter: { type: [2] } }),
    });
    if (!res.ok)
        throw new Error('bangumi search ' + res.status);
    const data = await res.json();
    const list = data?.data ?? data?.list ?? [];
    return list.map(toSubject);
}
/** 番剧详情 */
export async function getSubject(id) {
    return toSubject(await apiGet('/v0/subjects/' + id));
}
/** 剧集列表（放送日期 —> 对应周几） */
export async function getEpisodes(subjectId) {
    const data = await apiGet('/v0/episodes?subject_id=' + subjectId + '&limit=200&offset=0');
    const list = data?.data ?? [];
    return list
        .filter((e) => (e.type === undefined || e.type === 0)) // 0=本篇正片
        .map((e) => ({
        ep: typeof e.ep === 'number' ? e.ep : e.sort ?? e.sort_raw ?? 0,
        airDate: typeof e.airdate === 'string' && e.airdate && e.airdate !== '0000-00-00' ? e.airdate : undefined,
        name: e.name,
        nameCn: e.name_cn,
    }))
        .filter((e) => e.ep > 0);
}
/** 取番详情（7 天缓存），附别名集合；miss 时打 API 并回填 */
export async function getSubjectCached(id) {
    const { getDb } = await import('./db.js');
    const hit = getDb().getSubjectCache(id);
    if (hit)
        return { subject: hit.subject, aliases: hit.aliases, fromCache: true };
    try {
        const subject = await getSubject(id);
        const aliases = subject.aliases ?? [subject.name, subject.nameCn].filter(Boolean);
        getDb().setSubjectCache(id, subject, aliases);
        return { subject, aliases, fromCache: false };
    }
    catch (e) {
        const { logActivity } = await import('./db.js');
        logActivity('warn', 'bgm-api', 'subject #' + id + ' 拉取失败：' + (e instanceof Error ? e.message : String(e)));
        throw e;
    }
}
/** 取本篇剧集列表（6 小时缓存） */
export async function getEpisodesCached(subjectId) {
    const { getDb } = await import('./db.js');
    const hit = getDb().getEpisodesCache(subjectId);
    if (hit)
        return hit.episodes;
    // 网络失败时回退陈缓存（stale-on-error,2026-09-05）：放送日期基本固化，
    // 离线也不能让「已放送」整列消失——宁可用旧日期
    try {
        const episodes = await getEpisodes(subjectId);
        getDb().setEpisodesCache(subjectId, episodes);
        return episodes;
    }
    catch (e) {
        const { logActivity } = await import('./db.js');
        logActivity('warn', 'bgm-api', 'episodes #' + subjectId + ' 刷新失败：' + (e instanceof Error ? e.message : String(e)));
        const stale = getDb().getEpisodesCache(subjectId, true);
        if (stale)
            return stale.episodes;
        throw e;
    }
}
//# sourceMappingURL=bangumi.js.map