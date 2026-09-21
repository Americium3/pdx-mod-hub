export type Lang = 'en' | 'zh'

const dict = {
  // nav
  'nav.updates': { en: 'Updates', zh: '更新动态' },
  'nav.library': { en: 'Library', zh: '模组库' },
  'nav.browse': { en: 'Browse', zh: '浏览工坊' },
  'nav.settings': { en: 'Settings', zh: '设置' },
  'nav.tagline': { en: 'Paradox Workshop Tracker', zh: 'P社创意工坊追踪器' },

  // command rail
  'rail.wordmark': { en: 'GROUND STATION', zh: 'GROUND STATION' },
  'rail.games': { en: 'Games', zh: '游戏' },
  'rail.collapse': { en: 'Collapse rail', zh: '收起侧栏' },
  'rail.expand': { en: 'Expand rail', zh: '展开侧栏' },
  'rail.allGames': { en: 'All games', zh: '全部游戏' },

  // ops bar
  'ops.poll': { en: 'POLL', zh: '轮询' },
  'ops.pollFailed': { en: 'POLL FAILED · retrying', zh: '轮询失败 · 重试中' },
  'ops.stale': { en: 'STALE {t}', zh: '数据陈旧 {t}' },
  'ops.steam': { en: 'STEAM', zh: 'STEAM' },
  'ops.running': { en: 'RUNNING', zh: '运行中' },
  'ops.offline': { en: 'OFFLINE', zh: '离线' },
  'ops.link': { en: 'LINK', zh: '连接' },
  'ops.linkDown': { en: 'LINK DOWN', zh: '连接断开' },
  'ops.awaiting': { en: '{n} AWAITING', zh: '{n} 待发现' },
  'ops.helper': { en: 'HELPER', zh: '助手' },
  'ops.refresh': { en: 'Check now', zh: '立即检查' },
  'ops.nextPoll': { en: 'Next poll', zh: '下次轮询' },

  // stamps (bilingual set from DESIGN_SPEC §5 — exact strings)
  'stamp.awaiting': { en: 'AWAITING STEAM', zh: '待 Steam 发现' },
  'stamp.queued': { en: 'QUEUED FOR LAUNCH', zh: '待启动下载' },
  'stamp.downloading': { en: 'DOWNLOADING', zh: '下载中' },
  'stamp.fetched': { en: 'FETCHED {t}', zh: '已拉取 {t}' },
  'stamp.removed': { en: 'REMOVED', zh: '已移除' },
  'stamp.banned': { en: 'BANNED', zh: '已封禁' },
  'stamp.orphaned': { en: 'UNSUBSCRIBED · as of {t}', zh: '已退订 · 数据截至 {t}' },
  'stamp.unverified': { en: 'UNVERIFIED', zh: '未验证' },
  'stamp.syncToVerify': { en: 'Sync to verify', zh: '同步以验证' },

  // state dot labels (plain 13px labels)
  'state.awaiting-steam': { en: 'Awaiting Steam', zh: '待 Steam 发现' },
  'state.queued-for-launch': { en: 'Queued for launch', zh: '待启动下载' },
  'state.downloading': { en: 'Downloading', zh: '下载中' },
  'state.up-to-date': { en: 'Up to date', zh: '已最新' },
  'state.not-installed': { en: 'Not installed', zh: '未安装' },
  'state.orphaned': { en: 'Unsubscribed', zh: '已退订残留' },
  'state.unverified': { en: 'Unverified', zh: '未验证' },
  'state.removed': { en: 'Removed', zh: '已移除' },
  'state.banned': { en: 'Banned', zh: '已封禁' },
  'state.error': { en: 'Error', zh: '错误' },
  'state.drive-offline': { en: 'DRIVE OFFLINE', zh: '磁盘离线' },

  // command palette
  'palette.placeholder': { en: 'Search mods or type a command…', zh: '搜索模组或输入命令…' },
  'palette.mods': { en: 'Mods', zh: '模组' },
  'palette.pages': { en: 'Pages', zh: '页面' },
  'palette.actions': { en: 'Actions', zh: '操作' },
  'palette.noResults': { en: 'No matches', zh: '无匹配结果' },
  'palette.checkNow': { en: 'Check for updates now', zh: '立即检查更新' },
  'palette.syncAll': { en: 'Sync all subscriptions', zh: '同步全部订阅' },
  'palette.switchLang': { en: 'Switch language → 中文', zh: '切换语言 → English' },
  'palette.switchTheme': { en: 'Switch theme', zh: '切换主题' },
  'palette.hint': { en: '↑↓ select · ↵ open · esc close', zh: '↑↓ 选择 · ↵ 打开 · esc 关闭' },
  'palette.open': { en: 'Command palette', zh: '命令面板' },

  // toasts / generic feedback
  'toast.actionFailed': { en: 'Action failed: {e}', zh: '操作失败：{e}' },
  'toast.actionDone': { en: 'Done: {t}', zh: '已完成：{t}' },
  'toast.unconfirmed': {
    en: 'Steam reported success but the files have not changed yet.',
    zh: 'Steam 报告成功，但文件尚未变化。',
  },
  'toast.copied': { en: 'Copied {t}', zh: '已复制 {t}' },
  'toast.steamNotRunning': {
    en: 'Steam is not running. Start Steam and retry.',
    zh: 'Steam 未运行，请启动 Steam 后重试。',
  },

  // inline confirm
  'confirm.unsubscribe': { en: 'Confirm unsubscribe?', zh: '确认退订？' },
  'confirm.generic': { en: 'Confirm?', zh: '确认？' },

  // detail sheet shell
  'detail.close': { en: 'Close', zh: '关闭' },
  'detail.title': { en: 'Mod detail', zh: '模组详情' },

  // detail sheet content
  'detail.tab.description': { en: 'Description', zh: '描述' },
  'detail.removedBanner': {
    en: 'This mod has been removed from the Workshop. Cached data is shown.',
    zh: '该模组已从创意工坊移除，以下为缓存数据。',
  },
  'detail.bannedBanner': {
    en: 'This mod has been banned by Steam and is no longer available.',
    zh: '该模组已被 Steam 封禁，创意工坊不再提供。',
  },
  'detail.loadFailed': { en: 'Failed to load details: {e}', zh: '详情加载失败：{e}' },
  'detail.noDescription': { en: 'No description provided.', zh: '暂无描述。' },
  'detail.modId': { en: 'Workshop ID', zh: '工坊 ID' },

  // statuses (legacy keys, kept)
  'status.update-available': { en: 'Update ready', zh: '有更新' },
  'status.up-to-date': { en: 'Up to date', zh: '已最新' },
  'status.not-installed': { en: 'Not fetched', zh: '未下载' },
  'status.orphaned': { en: 'Unsubscribed', zh: '已退订残留' },
  'status.removed': { en: 'Removed from Workshop', zh: '已从工坊移除' },
  'status.unknown': { en: 'No data yet', zh: '暂无数据' },

  // updates page
  'updates.title': { en: 'Updates', zh: '更新动态' },
  'updates.subtitle': { en: 'What changed across your Paradox mods', zh: '你的P社模组最近都改了什么' },
  'updates.pendingBanner': {
    en: '{n} mods updated on the Workshop; Steam has not fetched them yet',
    zh: '{n} 个模组已在创意工坊更新，Steam 尚未拉取',
  },
  'updates.allClear': { en: 'Everything is current. Steam has fetched every update.', zh: '一切都是最新的，Steam 已拉取全部更新。' },
  'updates.emptyFeed': { en: 'No updates detected yet. The tracker polls every {n} minutes.', zh: '还没有检测到更新。追踪器每 {n} 分钟轮询一次。' },
  'updates.detected': { en: 'detected {t}', zh: '检测于 {t}' },
  'updates.noticed': { en: 'noticed {t}', zh: '发现于 {t}' },
  'updates.fetchedBySteam': { en: 'Fetched by Steam {t}', zh: 'Steam 已于 {t} 拉取' },
  'updates.notFetched': { en: 'Steam has not fetched this yet', zh: 'Steam 尚未拉取' },
  'updates.changelog': { en: 'Changelog', zh: '更新日志' },
  'updates.noNotes': { en: 'No notes provided', zh: '无更新说明' },
  'updates.loadOlder': { en: 'Older entries', zh: '更早的日志' },
  'updates.showingOf': { en: 'Showing {a} of {b} · View all', zh: '显示 {a} / {b} · 查看全部' },
  'updates.updatedAt': { en: 'UPDATED {t}', zh: '更新于 {t}' },
  'updates.launchQueue': { en: 'Awaiting Steam ({n})', zh: '待 Steam 发现（{n}）' },
  'updates.receivedToday': { en: 'Received today', zh: '今日已接收' },
  'updates.forceAll': { en: 'Force download all', zh: '全部强制下载' },
  'updates.missionLog': { en: 'Mission log', zh: '任务日志' },
  'updates.entry.update': { en: 'Update: {t}', zh: '更新：{t}' },
  'updates.expand': { en: 'Expand', zh: '展开' },
  'updates.collapse': { en: 'Collapse', zh: '收起' },
  'updates.retry': { en: 'Retry', zh: '重试' },
  'updates.feedError': { en: 'Could not load the mission log.', zh: '无法加载任务日志。' },

  // library
  'library.title': { en: 'Library', zh: '模组库' },
  'library.subtitle': { en: 'Every subscribed and installed mod, by game', zh: '按游戏归类的全部订阅与已装模组' },
  'library.search': { en: 'Filter mods…', zh: '筛选模组…' },
  'library.all': { en: 'All games', zh: '全部游戏' },
  'library.sort.updated': { en: 'Recently updated', zh: '最近更新' },
  'library.sort.name': { en: 'Name', zh: '名称' },
  'library.sort.size': { en: 'Size', zh: '体积' },
  'library.sort.subs': { en: 'Subscribers', zh: '订阅数' },
  'library.sort.added': { en: 'Date added', zh: '添加时间' },
  'library.sort.state': { en: 'State', zh: '状态' },
  'library.installed': { en: '{n} installed', zh: '已装 {n}' },
  'library.updatesPending': { en: '{n} updates pending', zh: '{n} 个待更新' },
  'library.syncHint': { en: 'Sync subscriptions from Steam (brief in-game flash)', zh: '从 Steam 同步订阅（会短暂显示游戏中）' },
  'library.synced': { en: 'Synced {t}', zh: '同步于 {t}' },
  'library.neverSynced': { en: 'Local files only. Sync to see account subscriptions', zh: '仅本地文件，同步后可见账户订阅' },
  'library.empty': { en: 'No mods match.', zh: '没有匹配的模组。' },
  'library.totals': { en: '{n} mods · {s}', zh: '{n} 个模组 · {s}' },
  'library.totalsGames': { en: '{n} mods · {s} · {g} games', zh: '{n} 个模组 · {s} · {g} 款游戏' },
  'library.chip.awaiting': { en: 'Awaiting', zh: '待发现' },
  'library.chip.queued': { en: 'Queued', zh: '待下载' },
  'library.chip.downloading': { en: 'Downloading', zh: '下载中' },
  'library.chip.orphaned': { en: 'Orphaned', zh: '退订残留' },
  'library.chip.notInstalled': { en: 'Not installed', zh: '未安装' },
  'library.chip.removed': { en: 'Removed', zh: '已移除' },
  'library.col.name': { en: 'Mod', zh: '模组' },
  'library.col.state': { en: 'State', zh: '状态' },
  'library.col.source': { en: 'Source', zh: '来源' },
  'library.col.targets': { en: 'Targets', zh: '适配版本' },
  'library.col.size': { en: 'Size', zh: '体积' },
  'library.col.subs': { en: 'Subs', zh: '订阅' },
  'library.col.updated': { en: 'Updated', zh: '更新于' },
  'library.col.added': { en: 'Added', zh: '添加于' },
  'library.source.workshop': { en: 'workshop', zh: '工坊' },
  'library.source.local': { en: 'local', zh: '本地' },
  'library.selected': { en: '{n} selected', zh: '已选 {n} 项' },
  'library.openFolders': { en: 'Open folders', zh: '打开文件夹' },
  'library.sort.label': { en: 'Sort', zh: '排序' },
  'library.clearSelection': { en: 'Clear selection', zh: '清除所选' },
  'library.chip.cared': { en: 'Watched', zh: '已关心' },

  // care flag — per-mod opt-in to update notifications
  'care.on': { en: 'Watch {title} for updates', zh: '关心《{title}》的更新' },
  'care.off': { en: 'Stop watching {title} for updates', zh: '不再关心《{title}》的更新' },
  'care.tipOn': { en: 'Watched, updates are announced', zh: '已关心，更新会通知你' },
  'care.tipOff': { en: 'Not watched, updates stay silent', zh: '未关心，更新不通知' },
  'care.label': { en: 'Watch for updates', zh: '关心更新' },
  'care.explain': {
    en: 'Only watched mods announce updates. The rest are still tracked; the library keeps showing what has an update waiting, it just does not interrupt you.',
    zh: '只有「关心」的模组在更新时通知你。其余照常追踪，模组库仍会显示谁有更新待装，只是不再打扰你。',
  },

  // browse
  'browse.title': { en: 'Browse', zh: '浏览工坊' },
  'browse.subtitle': { en: 'Search and subscribe straight from here', zh: '在这里直接搜索并订阅' },
  'browse.search': { en: 'Search the Workshop…', zh: '搜索创意工坊…' },
  'browse.sort.popular': { en: 'Most popular', zh: '最热门' },
  'browse.sort.trend7d': { en: '7 days', zh: '7 天' },
  'browse.sort.trend30d': { en: '30 days', zh: '30 天' },
  'browse.sort.updated': { en: 'Most recent', zh: '最近更新' },
  'browse.sort.published': { en: 'Newest', zh: '最新发布' },
  'browse.sort.subs': { en: 'Most subscribed', zh: '订阅最多' },
  'browse.results': { en: '{n} results', zh: '{n} 个结果' },
  'browse.page': { en: 'Page {n}', zh: '第 {n} 页' },
  'browse.loadMore': { en: 'Load 50 more', zh: '再加载 50 条' },
  'browse.capped': { en: 'End of Workshop results', zh: '已到工坊结果末尾' },
  'browse.helperNote': {
    en: 'Starts the Steam helper (brief in-game flash)',
    zh: '将启动 Steam 助手（短暂显示游戏中）',
  },
  'browse.pickGame': { en: 'Pick a game to browse its Workshop.', zh: '选择一个游戏来浏览它的创意工坊。' },
  'browse.notBrowsable': {
    en: 'This game has no public Workshop browser. Your Library is unaffected.',
    zh: '该游戏没有公开的创意工坊浏览器，模组库不受影响。',
  },
  'browse.subscribed': { en: 'SUBSCRIBED', zh: '已订阅' },
  'browse.installed': { en: 'INSTALLED', zh: '已安装' },
  'browse.empty': { en: 'No results.', zh: '没有结果。' },
  'browse.requiredItems': { en: 'This mod requires {n} other items', zh: '该模组需要 {n} 个前置' },
  'browse.subscribeAll': { en: 'Subscribe to all', zh: '全部订阅' },
  'browse.notEnoughRatings': { en: 'Not enough ratings', zh: '评分不足' },
  'browse.viewRows': { en: 'Rows', zh: '列表' },
  'browse.viewGrid': { en: 'Posters', zh: '海报' },
  'browse.sort.relevance': { en: 'Relevance', zh: '相关性' },
  'browse.sort.alltime': { en: 'All time', zh: '全部时间' },
  'browse.noticeDismiss': { en: 'Got it', zh: '知道了' },
  'browse.loadFailed': { en: 'Could not load Workshop results.', zh: '无法加载创意工坊结果。' },
  'browse.openLibrary': { en: 'Open Library', zh: '打开模组库' },

  // actions
  'action.subscribe': { en: 'Subscribe', zh: '订阅' },
  'action.unsubscribe': { en: 'Unsubscribe', zh: '退订' },
  'action.download': { en: 'Download now', zh: '立即下载' },
  'action.force': { en: 'Force download', zh: '强制下载' },
  'action.sync': { en: 'Sync', zh: '同步' },
  'action.syncAll': { en: 'Sync all', zh: '全部同步' },
  'action.openSteam': { en: 'Open in Steam', zh: '在 Steam 打开' },
  'action.openBrowser': { en: 'Open in browser', zh: '在浏览器打开' },
  'action.openFolder': { en: 'Open folder', zh: '打开文件夹' },
  'action.copyId': { en: 'Copy ID', zh: '复制 ID' },
  'action.launchGame': { en: 'Launch game', zh: '启动游戏' },
  'action.checkNow': { en: 'Check now', zh: '立即检查' },
  'action.working': { en: 'Working…', zh: '处理中…' },
  'action.done': { en: 'Done', zh: '完成' },
  'action.failed': { en: 'Failed', zh: '失败' },
  'action.more': { en: 'More actions', zh: '更多操作' },
  'action.retry': { en: 'Retry', zh: '重试' },
  'action.queuePosition': { en: 'Queued #{n}', zh: '排队第 {n} 位' },

  // action stages (SSE)
  'stage.queued': { en: 'Queued', zh: '已排队' },
  'stage.helper_starting': { en: 'Starting helper', zh: '启动助手中' },
  'stage.subscribed': { en: 'Subscribed', zh: '已订阅' },
  'stage.downloading': { en: 'Downloading', zh: '下载中' },
  'stage.result': { en: 'Steam accepted', zh: 'Steam 已受理' },
  'stage.acf_confirmed': { en: 'Files confirmed', zh: '文件已确认' },
  'stage.result_ok_unconfirmed': { en: 'Done (unconfirmed)', zh: '完成（未确认）' },
  'stage.failed': { en: 'Failed', zh: '失败' },

  // meta labels
  'meta.size': { en: 'Size', zh: '体积' },
  'meta.sizeOnDisk': { en: 'On disk', zh: '本地占用' },
  'meta.subscribers': { en: 'Subscribers', zh: '订阅者' },
  'meta.favorites': { en: 'Favorites', zh: '收藏' },
  'meta.views': { en: 'Views', zh: '浏览' },
  'meta.posted': { en: 'Posted', zh: '发布' },
  'meta.updatedRemote': { en: 'Workshop update', zh: '工坊更新' },
  'meta.updatedLocal': { en: 'Local copy', zh: '本地副本' },
  'meta.tags': { en: 'Tags', zh: '标签' },
  'meta.author': { en: 'Author', zh: '作者' },
  'meta.rating': { en: 'Rating', zh: '评分' },
  'meta.dependencies': { en: 'Requires', zh: '前置需求' },
  'meta.requiredBy': { en: 'Required by', zh: '被以下模组需要' },
  'meta.dlc': { en: 'Required DLC', zh: '所需 DLC' },
  'meta.missingDep': { en: 'Missing dependency', zh: '缺少前置' },
  'meta.targets': { en: 'Targets {r}', zh: '适配 {r}' },

  // settings
  'settings.title': { en: 'Settings', zh: '设置' },
  'settings.subtitle': { en: 'Tracker behaviour and paths', zh: '追踪行为与路径' },
  'settings.polling': { en: 'Polling', zh: '轮询' },
  'settings.pollInterval': { en: 'Poll interval (seconds)', zh: '轮询间隔（秒）' },
  'settings.pollIntervalHint': {
    en: 'How often the Steam Web API is checked for mod updates (60–3600s).',
    zh: '多久检查一次 Steam Web API 上的模组更新（60–3600 秒）。',
  },
  'settings.prefetch': { en: 'Prefetch changelogs', zh: '预取更新日志' },
  'settings.prefetchHint': {
    en: 'Fetch change notes automatically when an update is detected.',
    zh: '检测到更新时自动抓取更新说明。',
  },
  'settings.prefetchCap': { en: 'Prefetch queue cap', zh: '预取队列上限' },
  'settings.language': { en: 'Language', zh: '界面语言' },
  'settings.theme': { en: 'Theme', zh: '主题' },
  'settings.dataFolder': { en: 'Data folder', zh: '数据目录' },
  'settings.dataFolderOpen': { en: 'Open', zh: '打开' },
  'settings.dataFolderChange': { en: 'Change…', zh: '更改…' },
  'settings.imageCache': { en: 'Image cache', zh: '图片缓存' },
  'settings.imageCacheClear': { en: 'Clear', zh: '清空' },
  'settings.diagnostics': { en: 'Diagnostics', zh: '诊断' },
  'settings.status': { en: 'Tracker status', zh: '追踪器状态' },
  'settings.steamRunning': { en: 'Steam client', zh: 'Steam 客户端' },
  'settings.running': { en: 'running', zh: '运行中' },
  'settings.notRunning': { en: 'not running, actions disabled', zh: '未运行，动作已禁用' },
  'settings.lastPoll': { en: 'Last poll', zh: '上次轮询' },
  'settings.helperState': { en: 'Helper', zh: '助手' },
  'settings.seq': { en: 'Event seq', zh: '事件序号' },
  'settings.libraries': { en: 'Steam libraries', zh: 'Steam 库目录' },
  'settings.save': { en: 'Save', zh: '保存' },
  'settings.saved': { en: 'Saved', zh: '已保存' },
  'settings.syncedAt': { en: 'Synced {t}', zh: '同步于 {t}' },
  'settings.interface': { en: 'Interface', zh: '界面' },
  'settings.storage': { en: 'Storage', zh: '存储' },
  'settings.steamRoot': { en: 'Steam root', zh: 'Steam 根目录' },
  'settings.helperActive': { en: 'active', zh: '工作中' },
  'settings.helperIdle': { en: 'idle', zh: '空闲' },
  'settings.colGame': { en: 'Game', zh: '游戏' },
  'settings.colSynced': { en: 'Last sync', zh: '上次同步' },
  'settings.syncAllHint': {
    en: 'Games sync sequentially through one helper queue (brief in-game flash each).',
    zh: '各游戏经单一助手队列依次同步（每个会短暂显示游戏中）。',
  },
  'settings.probeOwned': { en: 'Probe owned games', zh: '探测已拥有的游戏' },
  'settings.probeRun': { en: 'Probe', zh: '探测' },
  'settings.probeOwnedHint': {
    en: 'List Paradox games you own but have not installed (starts the Steam helper).',
    zh: '列出已拥有但未安装的P社游戏（将启动 Steam 助手）。',
  },
  'settings.ownedNotInstalled': { en: 'Owned, not installed', zh: '已拥有，未安装' },
  'settings.probeNone': {
    en: 'Every owned Paradox game is installed.',
    zh: '已拥有的P社游戏均已安装。',
  },
  'settings.dataFolderHint': {
    en: 'Mod state, events and caches live here. Changing it ships in a later version.',
    zh: '模组状态、事件与缓存存放于此。更改目录将在后续版本提供。',
  },
  'settings.imageCacheHint': {
    en: 'Proxied Steam art cached on disk.',
    zh: '缓存在本地磁盘的 Steam 图片。',
  },
  'settings.cacheCleared': { en: 'Image cache cleared', zh: '图片缓存已清空' },
  'settings.warnings': { en: 'Warnings', zh: '警告' },
  'settings.apiKey': { en: 'Steam Web API key', zh: 'Steam Web API 密钥' },
  'settings.apiKeyHint': {
    en: 'Optional. Speeds up author-name resolution via batched GetPlayerSummaries; leave empty to use the keyless profile lookup.',
    zh: '可选。通过批量 GetPlayerSummaries 加速作者名解析；留空则使用免密钥的资料页查询。',
  },
  'settings.apiKeyEmpty': { en: 'not set', zh: '未设置' },

  // theme
  'theme.auto': { en: 'Auto', zh: '跟随系统' },
  'theme.dark': { en: 'Dark', zh: '深色' },
  'theme.light': { en: 'Light', zh: '浅色' },

  // misc
  'misc.cancel': { en: 'Cancel', zh: '取消' },
  'misc.never': { en: 'never', zh: '从未' },
  'misc.justNow': { en: 'just now', zh: '刚刚' },
  'misc.today': { en: 'Today', zh: '今天' },
  'misc.yesterday': { en: 'Yesterday', zh: '昨天' },
  'misc.steamDown': {
    en: 'Steam is not running. Subscribe, download and sync are unavailable.',
    zh: 'Steam 未运行，订阅/下载/同步不可用。',
  },
  'misc.pollError': { en: 'Last poll failed: {e}', zh: '上次轮询失败：{e}' },
  'misc.loading': { en: 'Loading…', zh: '加载中…' },
  'misc.changelogUnavailable': { en: 'Changelog unavailable', zh: '更新日志暂不可用' },
  'misc.emptyGame': { en: 'No mods for this game yet.', zh: '该游戏还没有模组。' },
} as const

export type MsgKey = keyof typeof dict

export function translate(lang: Lang, key: MsgKey, vars?: Record<string, string | number>): string {
  let s: string = dict[key][lang]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

/** Both locale variants of a key — for reserved-width rendering (zero EN<->zh shift). */
export function pair(
  key: MsgKey,
  vars?: Record<string, string | number>,
): { en: string; zh: string } {
  return { en: translate('en', key, vars), zh: translate('zh', key, vars) }
}
