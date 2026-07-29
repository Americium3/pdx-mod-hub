export type Lang = 'en' | 'zh'

const dict = {
  // nav
  'nav.updates': { en: 'Updates', zh: '更新动态' },
  'nav.library': { en: 'Library', zh: '模组库' },
  'nav.browse': { en: 'Browse', zh: '浏览工坊' },
  'nav.settings': { en: 'Settings', zh: '设置' },
  'nav.tagline': { en: 'Paradox Workshop Tracker', zh: 'P社创意工坊追踪器' },

  // statuses
  'status.update-available': { en: 'Update ready', zh: '有更新' },
  'status.up-to-date': { en: 'Up to date', zh: '已最新' },
  'status.not-installed': { en: 'Not fetched', zh: '未下载' },
  'status.orphaned': { en: 'Unsubscribed', zh: '已退订残留' },
  'status.removed': { en: 'Removed from Workshop', zh: '已从工坊移除' },
  'status.unknown': { en: 'No data yet', zh: '暂无数据' },

  // updates page
  'updates.title': { en: 'Recent updates', zh: '最近更新' },
  'updates.subtitle': { en: 'What changed across your Paradox mods', zh: '你的P社模组最近都改了什么' },
  'updates.pendingBanner': {
    en: '{n} mods updated on the Workshop — Steam has not fetched them yet',
    zh: '{n} 个模组已在创意工坊更新——Steam 尚未拉取',
  },
  'updates.allClear': { en: 'Everything is current. Steam has fetched every update.', zh: '一切都是最新的，Steam 已拉取全部更新。' },
  'updates.emptyFeed': { en: 'No updates detected yet. The tracker polls every {n} minutes.', zh: '还没有检测到更新。追踪器每 {n} 分钟轮询一次。' },
  'updates.detected': { en: 'detected {t}', zh: '检测于 {t}' },
  'updates.fetchedBySteam': { en: 'Fetched by Steam {t}', zh: 'Steam 已于 {t} 拉取' },
  'updates.notFetched': { en: 'Steam has not fetched this yet', zh: 'Steam 尚未拉取' },
  'updates.changelog': { en: 'Changelog', zh: '更新日志' },
  'updates.noNotes': { en: 'The author did not write change notes for this update.', zh: '作者没有为这次更新写说明。' },
  'updates.loadOlder': { en: 'Older entries', zh: '更早的日志' },

  // library
  'library.title': { en: 'Library', zh: '模组库' },
  'library.subtitle': { en: 'Every subscribed and installed mod, by game', zh: '按游戏归类的全部订阅与已装模组' },
  'library.search': { en: 'Filter mods…', zh: '筛选模组…' },
  'library.all': { en: 'All games', zh: '全部游戏' },
  'library.sort.updated': { en: 'Recently updated', zh: '最近更新' },
  'library.sort.name': { en: 'Name', zh: '名称' },
  'library.sort.size': { en: 'Size', zh: '体积' },
  'library.sort.subs': { en: 'Subscribers', zh: '订阅数' },
  'library.installed': { en: '{n} installed', zh: '已装 {n}' },
  'library.updatesPending': { en: '{n} updates pending', zh: '{n} 个待更新' },
  'library.syncHint': { en: 'Sync subscriptions from Steam (brief in-game flash)', zh: '从 Steam 同步订阅（会短暂显示游戏中）' },
  'library.synced': { en: 'Synced {t}', zh: '同步于 {t}' },
  'library.neverSynced': { en: 'Local files only — sync to see account subscriptions', zh: '仅本地文件——同步后可见账户订阅' },
  'library.empty': { en: 'No mods match.', zh: '没有匹配的模组。' },

  // browse
  'browse.title': { en: 'Browse Workshop', zh: '浏览创意工坊' },
  'browse.subtitle': { en: 'Search and subscribe straight from here', zh: '在这里直接搜索并订阅' },
  'browse.search': { en: 'Search the Workshop…', zh: '搜索创意工坊…' },
  'browse.sort.trend': { en: 'Trending', zh: '本周热门' },
  'browse.sort.recent': { en: 'Newest', zh: '最新发布' },
  'browse.sort.updated': { en: 'Recently updated', zh: '最近更新' },
  'browse.sort.subs': { en: 'Most subscribed', zh: '订阅最多' },
  'browse.sort.votes': { en: 'Top rated', zh: '评分最高' },
  'browse.results': { en: '{n} results', zh: '{n} 个结果' },
  'browse.page': { en: 'Page {n}', zh: '第 {n} 页' },
  'browse.helperNote': {
    en: 'Browsing queries Steam through a short-lived helper — expect a brief in-game flash.',
    zh: '浏览通过瞬时 helper 查询 Steam——会有短暂的「游戏中」闪现。',
  },
  'browse.pickGame': { en: 'Pick a game to browse its Workshop.', zh: '选择一个游戏来浏览它的创意工坊。' },
  'browse.subscribed': { en: 'Subscribed', zh: '已订阅' },
  'browse.empty': { en: 'No results.', zh: '没有结果。' },

  // actions
  'action.subscribe': { en: 'Subscribe', zh: '订阅' },
  'action.unsubscribe': { en: 'Unsubscribe', zh: '退订' },
  'action.download': { en: 'Download now', zh: '立即下载' },
  'action.force': { en: 'Force re-download', zh: '强制重下' },
  'action.sync': { en: 'Sync', zh: '同步' },
  'action.openSteam': { en: 'Open in Steam', zh: '在 Steam 打开' },
  'action.openFolder': { en: 'Workshop page', zh: '工坊页面' },
  'action.checkNow': { en: 'Check now', zh: '立即检查' },
  'action.working': { en: 'Working…', zh: '处理中…' },
  'action.done': { en: 'Done', zh: '完成' },
  'action.failed': { en: 'Failed', zh: '失败' },

  // meta labels
  'meta.size': { en: 'Size', zh: '体积' },
  'meta.subscribers': { en: 'Subscribers', zh: '订阅者' },
  'meta.favorites': { en: 'Favorites', zh: '收藏' },
  'meta.views': { en: 'Views', zh: '浏览' },
  'meta.posted': { en: 'Posted', zh: '发布' },
  'meta.updatedRemote': { en: 'Workshop update', zh: '工坊更新' },
  'meta.updatedLocal': { en: 'Local copy', zh: '本地副本' },
  'meta.tags': { en: 'Tags', zh: '标签' },

  // settings
  'settings.title': { en: 'Settings', zh: '设置' },
  'settings.subtitle': { en: 'Tracker behaviour and paths', zh: '追踪行为与路径' },
  'settings.pollInterval': { en: 'Poll interval (minutes)', zh: '轮询间隔（分钟）' },
  'settings.pollIntervalHint': {
    en: 'How often the Steam Web API is checked for mod updates.',
    zh: '多久检查一次 Steam Web API 上的模组更新。',
  },
  'settings.prefetch': { en: 'Prefetch changelogs', zh: '预取更新日志' },
  'settings.prefetchHint': {
    en: 'Fetch change notes automatically when an update is detected.',
    zh: '检测到更新时自动抓取更新说明。',
  },
  'settings.language': { en: 'Language', zh: '界面语言' },
  'settings.steamRoot': { en: 'Steam root override', zh: 'Steam 根目录覆盖' },
  'settings.steamRootHint': {
    en: 'Leave empty to auto-detect from the registry.',
    zh: '留空则从注册表自动检测。',
  },
  'settings.status': { en: 'Tracker status', zh: '追踪器状态' },
  'settings.steamRunning': { en: 'Steam client', zh: 'Steam 客户端' },
  'settings.running': { en: 'running', zh: '运行中' },
  'settings.notRunning': { en: 'not running — actions disabled', zh: '未运行——动作已禁用' },
  'settings.lastPoll': { en: 'Last poll', zh: '上次轮询' },
  'settings.libraries': { en: 'Steam libraries', zh: 'Steam 库目录' },
  'settings.save': { en: 'Save', zh: '保存' },
  'settings.saved': { en: 'Saved', zh: '已保存' },
  'settings.probe': { en: 'Detect owned games', zh: '检测拥有的游戏' },
  'settings.probeHint': {
    en: 'Checks which Paradox games your account owns (brief in-game flash).',
    zh: '检查账户拥有哪些P社游戏（短暂「游戏中」闪现）。',
  },

  // theme
  'theme.auto': { en: 'Follow system', zh: '跟随系统' },
  'theme.dark': { en: 'Dark', zh: '深色' },
  'theme.light': { en: 'Light', zh: '浅色' },
  'settings.theme': { en: 'Theme', zh: '主题' },

  // misc
  'misc.never': { en: 'never', zh: '从未' },
  'misc.justNow': { en: 'just now', zh: '刚刚' },
  'misc.minAgo': { en: '{n}m ago', zh: '{n} 分钟前' },
  'misc.hourAgo': { en: '{n}h ago', zh: '{n} 小时前' },
  'misc.dayAgo': { en: '{n}d ago', zh: '{n} 天前' },
  'misc.steamDown': {
    en: 'Steam is not running. Subscribe, download and sync are unavailable.',
    zh: 'Steam 未运行，订阅/下载/同步不可用。',
  },
  'misc.pollError': { en: 'Last poll failed: {e}', zh: '上次轮询失败：{e}' },
  'misc.loading': { en: 'Loading…', zh: '加载中…' },
} as const

export type MsgKey = keyof typeof dict

export function translate(lang: Lang, key: MsgKey, vars?: Record<string, string | number>): string {
  let s: string = dict[key][lang]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}
