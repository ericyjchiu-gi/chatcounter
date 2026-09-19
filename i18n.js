/* Device-level language/theme preferences and compact UI translations. */
(() => {
  'use strict';
  const C=window.ChatCounter;
  const en={
    appName:'ChatGPT Message Meter',subtitle:'v1.9.0 · local usage index',checking:'Checking account…',close:'Close',settings:'Settings',back:'Back',
    landingEyebrow:'PRIVATE · LOCAL · CROSS-DEVICE',landingTitle:'See how you actually use ChatGPT.',
    landingLead:'Build a local usage index across your saved conversations, then track model usage over rolling 24-hour, 7-day and 30-day windows.',
    featureModels:'Usage by model',featureModelsText:'Normal chats, GPT-5.6 Pro and GPT-6 Pro, with raw model metadata available.',
    featureCoverage:'Progressive coverage',featureCoverageText:'Your dashboard becomes more complete as each conversation finishes indexing.',
    featureDevices:'Cross-device refresh',featureDevicesText:'Backend reconciliation picks up saved chats created on other devices.',
    privacyTitle:'Local metadata only',privacyText:'Chat text is not stored. The index contains message IDs, timestamps, model metadata and coverage state in this browser.',
    startIndexing:'Start indexing',noRequest:'No history request is made until you click Start indexing.',readingState:'Reading local state…',
    syncHistory:'SYNC & HISTORY',expand:'Expand +',collapse:'Collapse −',upToDate:'Up to date',refreshed:'refreshed {time}',syncing:'Syncing · {stage}',paused:'Paused · checkpoint saved',attention:'Attention required',
    rateLimited:'Rate limited · retry in {seconds}s',initialising:'Initialising · {stage} · {percent}%',discovering:'Initialising · discovering {stage}',ready:'Ready',
    hours24:'24 HOURS',days7:'7 DAYS',days30:'30 DAYS',indexed100:'100% indexed',fullCoverage:'{count} conversations · full coverage',queued:'Queued',waitingEarlier:'Waiting for earlier range',
    discoveringShort:'Discovering…',foundSoFar:'{count} conversations found so far',indexedPercent:'{percent}% indexed',indexedKnown:'{percent}% indexed of known history',
    indexedCount:'{indexed} / {total} conversations',projectsPending:'Projects pending',notStarted:'Not started',waitingIndexing:'Waiting for indexing',
    initialisingStep:'INITIALISING · STEP {step} OF 3',discoveringHistory:'Discovering {stage} history',indexingHistory:'Indexing {stage} history',cooldownSaved:'Server cooldown · progress saved',pausedSaved:'Indexing paused · progress saved',finalisingProjects:'Finalising {stage} Projects',
    conversationsFound:'{count} conversations found so far · {projects} Projects',conversationsIndexed:'{indexed} / {total} conversations indexed',knownHistory:'known history',conversationProgress:'conversation {current} of {total}',lastCheckpoint:'Last checkpoint {time}',retryIn:'Retry in {seconds}s',
    cache:'Cache',queue:'Queue',worker:'Worker',workerHeartbeat:'Worker heartbeat',instantCapture:'Instant capture',lastLive:'Last live capture',lastCheckpointLabel:'Last checkpoint',lastReconcile:'Last reconciliation',pace:'Pace',nextAttempt:'Next attempt',activity:'Activity',
    thisTab:'This tab',anotherTab:'Another ChatGPT tab',idle:'Idle — no scanner running',notNeeded:'Not needed while idle',off:'Off',experimentalOn:'Experimental listener on · {time}',
    auto:'Auto',conservative:'Conservative',fast:'Fast override (this tab session)',recovery:'Recovery mode',manualOnly:'Manual only',activeTabResume:'Resume when an active tab is available',openingNoScan:'Opening the Meter does not scan history',
    pause:'Pause',resume:'Resume',reconcileNow:'Refresh now',working:'Working…',needsAttention:'Needs attention',recheckSignIn:'Recheck sign-in',retryErrors:'Retry errors once',startNext:'Start next stage now',indexPace:'Indexing pace',autoRecommended:'Auto (recommended)',fastSession:'Fast · this tab session only',cooldownNever:'Server cooldowns are never bypassed.',
    liveCapture:'Instant live capture (experimental)',autoReconcile:'Auto reconcile backend',every15:'Every 15 min',every30:'Every 30 min',every60:'Every 60 min',autoResume:'Automatically resume started indexing',reconcileOpen:'Reconcile when the Meter opens',
    diagnostics:'Diagnostics & maintenance',copyDiagnostics:'Copy diagnostics',exportDiagnostics:'Export diagnostics.json',rebuildHistory:'Rebuild history',recentLog:'Recent sync log',metadataLog:'Up to 200 metadata-only events are retained. No tokens, chat text, response bodies or headers are exported.',
    advancedUsage:'ADVANCED CHAT USAGE & LIMITS',estimated:'Estimated from recorded replies',gpt6Pro:'GPT-6 PRO',gpt56Pro:'GPT-5.6 PRO',totalPro:'TOTAL PRO',today:'Today',thisWeek:'This week',sharedWeek:'Shared weekly pool',thisMonth:'Month to date',ofShared:'of shared allowance',recorded:'recorded',
    noAdvancedLimit:'No Advanced Chat allowance is assumed for this plan.',noAdvancedText:'Usage is still tracked, but no numeric cap is inferred.',howWorks:'How this works',
    usageTrend:'USAGE TREND',recordedReplies:'Recorded replies',normalChats:'Normal chats',totalProShort:'Total Pro',partialCoverage:'Partial coverage · {percent}% indexed. Counts are minimum observed values.',rangeNotStarted:'This range has not started indexing yet.',rangeDiscovering:'Discovering conversations in this range.',indexedCountLabel:'indexed count',recordedSoFar:'recorded so far',
    rawModel:'Raw model slug',effort:'Effort',selectedRange:'Selected range',lastUsed:'Last used',noReplies:'No recorded replies in this range.',exportCsv:'Export metadata CSV',
    exactUnknown:'Exact provider remaining may differ. Deleted, temporary or failed chats may not appear in saved history.',limitsReference:'Limits are plan-aware reference values, not a server-reported balance.',resetApplied:'Weekly estimates use your manual reset assumption.',rollingWeek:'No reset day is set, so weekly figures use a rolling 7-day window.',
    settingsTitle:'SETTINGS',usageEstimation:'Usage estimation',resetDay:'Weekly reset day',notSet:'Not set · rolling 7 days',resetTime:'Reset time',timezone:'Timezone',resetNote:'Manual estimate only. This does not change the provider’s actual reset.',language:'Language',browserDefault:'Browser default',english:'English',chinese:'中文',appearance:'Appearance',systemDefault:'System default',light:'Light',dark:'Dark',
    dataPortability:'Data & portability',exportIndex:'Export local index',importIndex:'Import local index',dataNote:'Backups contain metadata and coverage state, never chat text or authentication tokens.',stableId:'Stable extension identity is enabled for future upgrades.',save:'Save settings',saved:'Settings saved.',
    importConfirm:'Replace the current local index with this backup?',importSuccess:'Index restored. Refreshing dashboard.',invalidBackup:'The selected file is not a compatible ChatCounter backup.',sameAccountOnly:'This backup belongs to a different ChatGPT account.',
    monday:'Monday',tuesday:'Tuesday',wednesday:'Wednesday',thursday:'Thursday',friday:'Friday',saturday:'Saturday',sunday:'Sunday'
  };
  const zh={
    appName:'ChatGPT 消息计量器',subtitle:'v1.9.0 · 本地用量索引',checking:'正在识别账户…',close:'关闭',settings:'设置',back:'返回',
    landingEyebrow:'私密 · 本地 · 跨设备',landingTitle:'看清你实际如何使用 ChatGPT。',landingLead:'为已保存的对话建立本地用量索引，并查看滚动 24 小时、7 天和 30 天的模型使用情况。',
    featureModels:'按模型统计',featureModelsText:'普通聊天、GPT-5.6 Pro 与 GPT-6 Pro，并保留原始模型元数据。',featureCoverage:'逐步完成覆盖',featureCoverageText:'每完成一个对话的索引，仪表盘就更接近完整。',featureDevices:'跨设备刷新',featureDevicesText:'通过后端增量同步补齐其他设备创建的已保存对话。',
    privacyTitle:'仅保存本地元数据',privacyText:'不会保存聊天正文。索引仅包含消息 ID、时间、模型元数据与覆盖状态。',startIndexing:'开始建立索引',noRequest:'点击“开始建立索引”前，不会请求任何历史记录。',readingState:'正在读取本地状态…',
    syncHistory:'同步与历史',expand:'展开 +',collapse:'收起 −',upToDate:'已是最新',refreshed:'{time}前刷新',syncing:'同步中 · {stage}',paused:'已暂停 · 进度已保存',attention:'需要处理',rateLimited:'触发限流 · {seconds} 秒后重试',initialising:'初始化 · {stage} · {percent}%',discovering:'初始化 · 正在发现{stage}',ready:'就绪',
    hours24:'24 小时',days7:'7 天',days30:'30 天',indexed100:'索引完成 100%',fullCoverage:'{count} 个对话 · 完整覆盖',queued:'等待中',waitingEarlier:'等待前一范围完成',discoveringShort:'发现中…',foundSoFar:'目前发现 {count} 个对话',indexedPercent:'已索引 {percent}%',indexedKnown:'已索引已知历史的 {percent}%',indexedCount:'{indexed} / {total} 个对话',projectsPending:'Projects 待补齐',notStarted:'尚未开始',waitingIndexing:'等待索引',
    initialisingStep:'初始化 · 第 {step}/3 步',discoveringHistory:'正在发现{stage}历史',indexingHistory:'正在索引{stage}历史',cooldownSaved:'服务器冷却中 · 进度已保存',pausedSaved:'索引已暂停 · 进度已保存',finalisingProjects:'正在完成{stage} Projects',conversationsFound:'目前发现 {count} 个对话 · {projects} 个 Projects',conversationsIndexed:'已索引 {indexed} / {total} 个对话',knownHistory:'已知历史',conversationProgress:'第 {current} / {total} 个对话',lastCheckpoint:'上次检查点：{time}',retryIn:'{seconds} 秒后重试',
    cache:'缓存',queue:'队列',worker:'执行器',workerHeartbeat:'执行器心跳',instantCapture:'即时捕获',lastLive:'上次即时捕获',lastCheckpointLabel:'上次检查点',lastReconcile:'上次同步',pace:'速率',nextAttempt:'下次尝试',activity:'当前活动',thisTab:'当前标签页',anotherTab:'另一 ChatGPT 标签页',idle:'空闲 · 没有扫描器运行',notNeeded:'空闲时不需要',off:'关闭',experimentalOn:'实验监听已开启 · {time}',auto:'自动',conservative:'保守',fast:'快速覆盖（仅当前标签页）',recovery:'恢复模式',manualOnly:'仅手动',activeTabResume:'有活动标签页时继续',openingNoScan:'打开计量器不会扫描历史',
    pause:'暂停',resume:'继续',reconcileNow:'立即刷新',working:'处理中…',needsAttention:'需要处理',recheckSignIn:'重新检查登录',retryErrors:'重试错误一次',startNext:'立即开始下一阶段',indexPace:'索引速率',autoRecommended:'自动（推荐）',fastSession:'快速 · 仅当前标签页',cooldownNever:'不会绕过服务器冷却。',liveCapture:'即时捕获（实验性）',autoReconcile:'自动同步后端',every15:'每 15 分钟',every30:'每 30 分钟',every60:'每 60 分钟',autoResume:'自动继续已开始的索引',reconcileOpen:'打开计量器时同步',
    diagnostics:'诊断与维护',copyDiagnostics:'复制诊断信息',exportDiagnostics:'导出 diagnostics.json',rebuildHistory:'重建历史索引',recentLog:'最近同步日志',metadataLog:'最多保留 200 条仅元数据日志；不会导出 token、聊天正文、响应正文或 headers。',
    advancedUsage:'高级聊天用量与限制',estimated:'根据已记录回复估算',gpt6Pro:'GPT-6 PRO',gpt56Pro:'GPT-5.6 PRO',totalPro:'PRO 总计',today:'今天',thisWeek:'本周',sharedWeek:'共享周额度',thisMonth:'本月至今',ofShared:'占共享额度',recorded:'已记录',noAdvancedLimit:'当前套餐不推定高级聊天额度。',noAdvancedText:'仍会统计用量，但不推断数字上限。',howWorks:'计算方式',usageTrend:'用量趋势',recordedReplies:'已记录回复',normalChats:'普通聊天',totalProShort:'Pro 总计',partialCoverage:'覆盖不完整 · 已索引 {percent}%。以下为已观察到的最低值。',rangeNotStarted:'该时间范围尚未开始索引。',rangeDiscovering:'正在发现该时间范围内的对话。',indexedCountLabel:'已索引数量',recordedSoFar:'目前已记录',
    rawModel:'原始模型标识',effort:'推理强度',selectedRange:'所选范围',lastUsed:'最近使用',noReplies:'该范围内没有已记录回复。',exportCsv:'导出元数据 CSV',exactUnknown:'准确剩余额度可能不同。已删除、临时或失败的聊天可能不会出现在已保存历史中。',limitsReference:'额度是按套餐配置的参考值，不是服务器返回的余额。',resetApplied:'每周估算使用你设置的重置假设。',rollingWeek:'未设置重置日，因此按滚动 7 天估算。',
    settingsTitle:'设置',usageEstimation:'用量估算',resetDay:'每周重置日',notSet:'未设置 · 滚动 7 天',resetTime:'重置时间',timezone:'时区',resetNote:'仅用于估算，不会改变服务商实际重置时间。',language:'语言',browserDefault:'跟随浏览器',english:'English',chinese:'中文',appearance:'外观',systemDefault:'跟随系统',light:'浅色',dark:'深色',dataPortability:'数据与迁移',exportIndex:'导出本地索引',importIndex:'导入本地索引',dataNote:'备份仅包含元数据与覆盖状态，不包含聊天正文或认证 token。',stableId:'已启用稳定扩展身份，供后续升级使用。',save:'保存设置',saved:'设置已保存。',importConfirm:'用此备份替换当前本地索引？',importSuccess:'索引已恢复，正在刷新仪表盘。',invalidBackup:'所选文件不是兼容的 ChatCounter 备份。',sameAccountOnly:'该备份属于另一个 ChatGPT 账户。',
    monday:'星期一',tuesday:'星期二',wednesday:'星期三',thursday:'星期四',friday:'星期五',saturday:'星期六',sunday:'星期日'
  };
  C.messages={en,zh};
  C.resolveLanguage=prefs=>prefs?.language==='zh'?'zh':prefs?.language==='en'?'en':/^zh\b/i.test(navigator.language||'')?'zh':'en';
  C.locale='en';
  C.t=(key,vars={})=>{
    const template=(C.messages[C.locale]||en)[key]??en[key]??key;
    return String(template).replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');
  };
})();
