/** 计算「已知拥有」的集号集合（本地库 ∪ qB ∪ downloads 单集 ∪ downloads 全集区间） */
export function collectHave(input) {
    const have = new Set(input.libraryEpisodes);
    for (const e of input.qbEpisodes)
        have.add(e);
    for (const d of input.downloads) {
        if (d.episode !== undefined)
            have.add(d.episode);
        if (d.rangeFrom !== undefined && d.rangeTo !== undefined) {
            for (let n = d.rangeFrom; n <= d.rangeTo; n += 1)
                have.add(n);
        }
    }
    return have;
}
function inRange(n, input) {
    for (const d of input.downloads) {
        if (d.rangeFrom !== undefined && d.rangeTo !== undefined && n >= d.rangeFrom && n <= d.rangeTo)
            return true;
    }
    return false;
}
/**
 * 判断一个打分候选是否被「已有」覆盖：
 *  - 整包（pack.isPack）：区间 [from..to] 内集号已全部拥有 → 覆盖；部分拥有 → 部分覆盖（区间内仍有缺失 → 可下载）；全集无区间但 seasonFull → 若已知总集数且本地已全 → 覆盖
 *  - 单集：episode 已在 have → 覆盖
 */
export function isCovered(c, have, input) {
    const p = c.pack;
    if (!p)
        return c.parsed?.episode !== undefined ? have.has(c.parsed.episode) : false;
    if (p.isPack) {
        if (p.multiSeason)
            return true; // 跨季合集对单季订阅视为覆盖（不可用）
        if (p.from !== undefined && p.to !== undefined) {
            let missing = 0;
            for (let n = p.from; n <= p.to; n += 1) {
                if (!have.has(n) && !inRange(n, input))
                    missing += 1;
            }
            return missing === 0;
        }
        if (p.seasonFull) {
            // 无区间全集：若已知总集数，检查 [1..total] 是否全有
            if (input.totalEpisodes !== undefined) {
                for (let n = 1; n <= input.totalEpisodes; n += 1)
                    if (!have.has(n))
                        return false;
                return true;
            }
            // 未知总集数：不判覆盖（由决策层决定）
            return false;
        }
        return false;
    }
    return false;
}
/** 整包覆盖哪些缺失集（用于记录区间，防后续重复） */
export function packCoverage(c, have) {
    const p = c.pack;
    if (!p?.isPack || p.multiSeason)
        return { missing: [] };
    const missing = [];
    if (p.from !== undefined && p.to !== undefined) {
        for (let n = p.from; n <= p.to; n += 1)
            if (!have.has(n))
                missing.push(n);
        return { missing, from: p.from, to: p.to };
    }
    return { missing };
}
/**
 * 主决策：给定输入，返回本轮该下载的动作序列。
 * 规则：
 *  - finished：优先全集资源（区间包/合集，含无单集号全集）——一次补全；无全集则按缺集逐集补
 *  - airing：只下「缺失单集」——整包资源视为会与未来单集重复/灌历史 → 不选全集；补缺至最新
 *  - 全集/区间已覆盖缺失集 → 不重复下载（即使日期新）
 *  - 收尾：全部集齐 → stopSubscription（finished 时置）
 */
export function decideDownloads(input) {
    const have0 = collectHave(input);
    const nowHave = new Set(have0);
    const actions = [];
    let fullCovered = false;
    // 全集已覆盖判定（downloads 有 full 区间含 1..total）
    const total = input.totalEpisodes;
    if (total !== undefined && total > 0) {
        const all = (() => {
            for (let n = 1; n <= total; n += 1)
                if (!nowHave.has(n))
                    return false;
            return true;
        })();
        if (all)
            fullCovered = true;
    }
    // 候选按分降序（rankItems 已排）
    const cands = input.candidates;
    const pickPrefer = (list) => {
        // 期望分辨率优先；其次 1080p；再原序
        const want = input.preferResolution?.toLowerCase() ?? '';
        if (want) {
            const exact = list.find((c) => c.parsed?.resolution?.toLowerCase() === want);
            if (exact)
                return exact;
        }
        const fhd = list.find((c) => c.parsed?.resolution?.toLowerCase().includes('1080'));
        if (fhd)
            return fhd;
        return list[0] ?? null;
    };
    if (input.finished) {
        // ===== 完结番：优先全集 =====
        const packs = cands.filter((c) => c.pack?.isPack && !c.pack.multiSeason);
        for (const pk of packs) {
            if (isCovered(pk, nowHave, input))
                continue;
            // 全集覆盖缺失集数
            const cov = packCoverage(pk, nowHave);
            if (cov.missing.length === 0)
                continue;
            // 全集（区间宽或含全集词）→ 一次下
            actions.push({
                kind: 'download', scored: pk, full: true,
                rangeFrom: cov.from, rangeTo: cov.to,
                why: '完结番全集资源（' + (pk.pack?.rangeRaw ?? pk.item.title.slice(0, 60)) + '），缺 ' + cov.missing.length + ' 集',
            });
            for (const n of cov.missing)
                nowHave.add(n);
            if (total !== undefined) {
                const all = (() => { for (let n = 1; n <= total; n += 1)
                    if (!nowHave.has(n))
                        return false; return true; })();
                if (all)
                    fullCovered = true;
            }
            break; // 一次全集足够，避免重复下多个全集
        }
        if (!fullCovered) {
            // 无全集/全集不全 → 逐缺集补（单集种子）
            const wantEps = [];
            const end = total ?? Math.max(0, ...nowHave);
            for (let n = 1; n <= end; n += 1)
                if (!nowHave.has(n))
                    wantEps.push(n);
            // 每个缺失集找候选里最匹配的单集
            const byEp = new Map();
            for (const c of cands) {
                const ep = c.parsed?.episode;
                if (ep === undefined || c.pack?.isPack)
                    continue;
                if (!nowHave.has(ep) && wantEps.includes(ep)) {
                    const arr = byEp.get(ep) ?? (byEp.set(ep, []), byEp.get(ep));
                    arr.push(c);
                }
            }
            for (const ep of wantEps) {
                const list = byEp.get(ep);
                if (!list?.length)
                    continue;
                const pk = pickPrefer(list);
                if (!pk)
                    continue;
                actions.push({ kind: 'download', scored: pk, full: false, episode: ep, why: '完结番补缺集 EP' + ep });
                nowHave.add(ep);
            }
        }
    }
    else {
        // ===== 连载/未完结：补缺至最新，全集一律不选 =====
        const singles = cands.filter((c) => c.parsed?.episode !== undefined && !c.pack?.isPack);
        const byEp = new Map();
        for (const c of singles) {
            const ep = c.parsed.episode;
            if (nowHave.has(ep))
                continue;
            const arr = byEp.get(ep) ?? (byEp.set(ep, []), byEp.get(ep));
            arr.push(c);
        }
        // 缺失集号列表（按序补：总集数已知 → 1..total；未知 → 已有最大+1..候选最大）
        const wantEps = new Set();
        if (total !== undefined) {
            for (let n = 1; n <= total; n += 1)
                if (!nowHave.has(n) && byEp.has(n))
                    wantEps.add(n);
        }
        else {
            for (const n of byEp.keys())
                if (!nowHave.has(n))
                    wantEps.add(n);
        }
        for (const ep of [...wantEps].sort((a, b) => a - b)) {
            const list = byEp.get(ep);
            if (!list?.length)
                continue;
            const pk = pickPrefer(list);
            if (!pk)
                continue;
            actions.push({ kind: 'download', scored: pk, full: false, episode: ep, why: '连载补缺 EP' + ep });
            nowHave.add(ep);
        }
    }
    // 齐集判定（含本轮新增）
    let allCovered = false;
    if (total !== undefined && total > 0) {
        let ok = true;
        for (let n = 1; n <= total; n += 1) {
            if (!nowHave.has(n)) {
                ok = false;
                break;
            }
        }
        allCovered = ok;
    }
    const stopSubscription = allCovered && input.finished;
    return { actions, nowHave, fullCovered, allCovered, stopSubscription };
}
//# sourceMappingURL=decision.js.map