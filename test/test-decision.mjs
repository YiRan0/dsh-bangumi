
import { decideDownloads, collectHave } from './lib/host/decision.js'
import { parseRss } from './lib/host/rss.js'
import { detectPack, parseEpisode } from './lib/host/parse.js'
import { rankItems } from './lib/host/match.js'

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra ?? '') }
}

// ---- detectPack 真实样本 ----
console.log('== detectPack ==')
const samples = [
  ['[7³ACG] 葬送的芙莉莲/Sousou no Frieren S01 | 01-28+SPx11 [简繁字幕] BDrip 1080p x265 OPUS 2.0', { pack: true, from: 1, to: 28 }],
  ['[Zzz睡不醒][葬送的芙莉莲 第二季][Sousou no Frieren 2nd Season][01-10][BDRip][1080P][HEVC-10bit][简繁日内封][MKV]', { pack: true, from: 1, to: 10 }],
  ['[豌豆字幕组&风之圣殿&LoliHouse] 咒术回战 / Jujutsu Kaisen [48-59 修正合集][WebRip 1080p HEVC-10bit AAC][简繁外挂字幕][Fin]', { pack: true, from: 48, to: 59 }],
  ['[Xspitfire911] 葬送的芙莉莲/Sousou No Frieren S01 + S02 BDRIP 1080p X265 10bit VOSTFR', { pack: true, multiSeason: true }],
  ['[ReinForce] 葬送的芙莉莲 S1-S2 / 葬送のフリーレン /Sousou no Frieren (BDRip 1920x1080 x264 FLAC)', { pack: true, multiSeason: true }],
  ['[DBD-Raws][药屋少女的呢喃 第二季/Kusuriya no Hitorigoto S2][01-24TV全集+SP][1080P][BDRip][HEVC-10bit][简繁日双语外挂][FLAC][MKV]', { pack: true, from: 1, to: 24 }],
  ['[jibaketa合成][代理商粵語]葬送的芙莉蓮 第二季 - 10 END [粵日雙語+內封繁體中文字幕] (WEB 1920x1080 AVC AACx2 SRT MUSE CHT)', { pack: true, flags: ['end'] }],
  ['[三明治摆烂组] LV999的村民 / Lv999 no Murabito / LV999の村人 - 11 - [繁日内嵌][AVC 8bit 1080P]', { pack: false }],
  ['[北宇治字幕组] 药屋少女的呢喃 / 药屋少女的独语 / Kusuriya no Hitorigoto [48][WebRip][HEVC_AAC][简繁日内封]', { pack: false }],
  ['[DBD-Raws][药屋少女的呢喃 第二季/Kusuriya no Hitorigoto S2][13-18TV][BOX3][1080P][BDRip][HEVC-10bit][FLAC][MKV]', { pack: true, from: 13, to: 18 }],
]
for (const [title, exp] of samples) {
  const p = detectPack(title)
  check(title.slice(0, 30), !!p === !!exp.pack, JSON.stringify(p))
  if (p && exp.pack) {
    if (exp.from !== undefined) check(title.slice(0, 20) + ' from', p.from === exp.from, 'got ' + p.from)
    if (exp.to !== undefined) check(title.slice(0, 20) + ' to', p.to === exp.to, 'got ' + p.to)
    if (exp.multiSeason) check(title.slice(0, 20) + ' multi', p.multiSeason === true, JSON.stringify(p))
  }
}

// ---- parseEpisode 单集 vs 全集 ----
console.log('== parseEpisode ==')
const ep1 = parseEpisode('[三明治摆烂组] LV999的村民 / Lv999 no Murabito / LV999の村人 - 11 - [繁日内嵌][AVC 8bit 1080P]')
check('airing single ep11', ep1.episode === 11, JSON.stringify(ep1))
const ep2 = parseEpisode('[Zzz睡不醒][葬送的芙莉莲 第二季][Sousou no Frieren 2nd Season][01-10][BDRip][1080P][HEVC-10bit][简繁日内封][MKV]')
check('finished full pack has no single ep', ep2.episode === undefined || (ep2.episode !== undefined && false), JSON.stringify(ep2))
const ep3 = parseEpisode('[jibaketa合成][代理商粵語]葬送的芙莉蓮 第二季 - 10 END [粵日雙語]')
check('END standalone single ep10 valid', ep3.episode === 10, JSON.stringify(ep3))

// ---- decideDownloads：完结全集优先 ----
console.log('== decideDownloads finished full-first ==')
function mkItem(title, magnet = 'magnet:?xt=urn:btih:abc' + Math.random().toString(16).slice(2)) {
  return { title, magnet, parsed: parseEpisode(title), pubDate: new Date().toISOString() }
}
const mkScored = (title) => rankItems([mkItem(title)], { aliases: ['frieren'] })[0]
const finCands = [
  mkScored('[7³ACG] 葬送的芙莉莲/Sousou no Frieren S01 | 01-28+SPx11 [BDrip 1080p x265]'),
  mkScored('[Zzz睡不醒][葬送的芙莉莲][01-10][BDRip][1080P][HEVC-10bit][简繁日内封]'),
  mkScored('[sub] 葬送的芙莉莲 / Sousou no Frieren - 05 [1080p]'),
  mkScored('[sub] 葬送的芙莉莲 / Sousou no Frieren - 12 [1080p]'),
]
const finDec = decideDownloads({
  totalEpisodes: 28, finished: true, libraryEpisodes: [], qbEpisodes: [], downloads: [],
  candidates: finCands, preferResolution: '1080p',
})
check('finished: 1 full-pack action', finDec.actions.length === 1, JSON.stringify(finDec.actions.map(a => a.why)))
check('finished: action is full', finDec.actions[0]?.full === true, JSON.stringify(finDec.actions[0]))
check('finished: range 1..28', finDec.actions[0]?.rangeFrom === 1 && finDec.actions[0]?.rangeTo === 28)

// ---- decideDownloads：已全有 -> 全集覆盖不重复 ----
console.log('== decideDownloads pack covered ==')
const covDec = decideDownloads({
  totalEpisodes: 28, finished: true,
  libraryEpisodes: Array.from({length: 28}, (_, i) => i + 1), qbEpisodes: [], downloads: [],
  candidates: finCands,
})
check('already all: no action', covDec.actions.length === 0, JSON.stringify(covDec.actions))
check('already all: allCovered + stop', covDec.allCovered && covDec.stopSubscription)

// ---- decideDownloads：连载只补缺 ----
console.log('== decideDownloads airing gap-fill ==')
const airCands = [
  mkScored('[sub] 测试番 / Test - 01 [1080p]'),
  mkScored('[sub] 测试番 / Test - 02 [1080p]'),
  mkScored('[7³ACG] 测试番/Test S01 | 01-12 [BDrip 1080p]'),  // 全集
]
const airDec = decideDownloads({
  totalEpisodes: 12, finished: false, libraryEpisodes: [1], qbEpisodes: [], downloads: [],
  candidates: airCands,
})
check('airing: download ep2 only (not full pack)', airDec.actions.length === 1 && airDec.actions[0]?.episode === 2, JSON.stringify(airDec.actions.map(a => ({ep: a.episode, why: a.why, full: a.full}))))

// ---- decideDownloads：downloads 全集区间覆盖防重复 ----
console.log('== decideDownloads downloads-full coverage ==')
const dlFull = decideDownloads({
  totalEpisodes: 12, finished: true, libraryEpisodes: [], qbEpisodes: [],
  downloads: [{ full: true, rangeFrom: 1, rangeTo: 12 }],
  candidates: [mkScored('[7³ACG] 测试番/Test S01 | 01-12 [BDrip 1080p]')],
})
check('downloads full range: no re-download', dlFull.actions.length === 0, JSON.stringify(dlFull.actions))

// ---- rankItems seasonOnly 过滤 ----
console.log('== seasonOnly filter ==')
const mkS = (title) => rankItems([{ title, magnet: 'magnet:?xt=urn:btih:xyz' + Math.random().toString(16).slice(2), parsed: parseEpisode(title), pubDate: new Date().toISOString() }], { aliases: ['frieren'], seasonOnly: 2 })[0]
// S2 订阅（seasonOnly=2）
const s2cands = [
  mkS('[Zzz睡不醒][葬送的芙莉莲 第二季][Sousou no Frieren 2nd Season][01-10][BDRip][1080P][HEVC-10bit][简繁日内封][MKV]'),
  mkS('[Xspitfire911] 葬送的芙莉莲/Sousou No Frieren S01 + S02 BDRIP 1080p X265 10bit VOSTFR'),
  mkS('[7³ACG] 葬送的芙莉莲/Sousou no Frieren S01 | 01-28+SPx11 [BDrip 1080p]'),
  mkS('[H-Enc] 葬送的芙莉莲 第二季 / Sousou no Frieren 2nd Season (BDRip 1080p HEVC FLAC)'),
]
check('season2: S2 single pack kept', s2cands[0] !== undefined)
check('season2: S1+S2 (contains S2) kept', s2cands[1] !== undefined, JSON.stringify(s2cands[1]?.pack))
check('season2: pure S1 full pack excluded', s2cands[2] === undefined, JSON.stringify(s2cands[2]?.item?.title))
check('season2: S2 no-mark kept', s2cands[3] !== undefined)

console.log(`\nRESULT: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
