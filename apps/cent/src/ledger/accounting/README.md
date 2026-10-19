# Accounting domain

本模块是独立的复式记账领域层，不依赖 React、IndexedDB 或远端服务。测试位于 apps/cent/tests。应用复用原记账、设置、账户筛选与统计 UI，直接提交新的 Account / Transaction / Entry。

## 数据边界

- Account 有资产、负债、费用、收入、权益五类；每个账户只有一种货币。账户 ID 为独立 UUID，预置显示含义由 presetKey 表达。
- 资产账户 paymentDisabled 未设置或为 false 时可作为支付资源；为 true 时在新交易的支付来源中隐藏。subscription 子类型强制为 true，表单勾选并锁定，创建、编辑及账本读取统一保证该值。它只控制表单选择，不影响余额、统计、收款或折旧，已引用该账户的历史交易仍可编辑。
- 父账户通过 parentId 组织账户；统计累加父账户自身及后代的分录，不把子账户余额重复记入父账户。普通父子账户须同类型、同币种；系统换汇平衡分组允许不同币种的权益子账户。
- Transaction 使用 type 表达业务类型，金额只保存于 entries。分录没有独立 ID，以 accountId 引用账户。
- 金额为 10000:1 的安全整数，借方正、贷方负。表单使用 decimalToAmount / amountToDecimal 精确转换；中间乘除使用 BigInt。
- 普通分录 amount 是账户原币金额。外币消费分录 currency = { base, target, amount } 中的 amount 是原币实际数量，外部 amount 仅为 base 币种估算。余额与借贷平衡统一读取 getEntryAmount，即 currency.amount ?? amount。
- time、createdAt、updatedAt 和可选 endTime 均为 UTC Unix 毫秒。账本 timeZone 控制日期输入、显示与统计分桶，不改变已保存时间戳。

## 交易、区间和子交易

列表展示由 list-rules.ts 按交易 type 选择用途，list-presentation.ts 读取分录生成主条目、子条目共用的金额、原币/到账数量、手续费和期间数据。借款显示借入本金，还款显示偿还本金，均使用中性色；这些展示金额不用于余额或收支统计。组件复用 transaction-display.tsx 的金额、备注与期间格式，备注和原币/到账信息同行，窄屏自然换行。

首页按交易 time 降序展示，最新的账单显示在最前；相同时间按 ID 降序，与数据库索引游标顺序一致。sync/book-page.ts 使用 SDK 的 IndexedDB time 索引每次读取 50 条索引记录，先取最新一批，首页 use-book-pages.ts 滚动接近末尾时继续读取更早的游标页，不在内存全量数组上截取分页。独立子交易不单独占主列表位置，与父账单一起展示；子交易的独立记录覆盖父级内嵌副本。删除记录不显示，writerSeq / repoSeq 变化后重新建立游标链，避免漏项和重复。

打开已有账本时先读取首批，store.preview 仅供只读首屏，完整账本在让出首帧后继续准备。完整校验前不展示金额、余额或统计，不开放编辑；准备完成后保留分页状态及滚动位置。store.current 始终保存完整数据，更新与导出绝不使用分页数据替换完整账本。transaction-list.tsx 使用已有的 TanStack Virtual，只挂载可见项与少量缓冲项，动态测量日期标题、图片、手续费和子账单的行高；搜索列表同样虚拟化，仍使用原有筛选与倒序。

createTransaction / updateTransaction 处理两账户收支、转账、还款、借款和资产购买。createJournalTransaction / updateJournalTransaction 处理完整自由分录；多账户交易不简化为两条分录。getEditableTransactionInput / getEditableJournalInput 还原对应输入，不支持的结构返回 undefined。

支出、收入和复式是同一交易的不同录入模式，可双向切换，不按原 type 或分录数量锁定。切到简易模式时按当前草稿的付款／收款分录预填金额和账户，保存后用所选账户重新生成两条平衡分录，并保留 ID、精确交易时间、创建时间及媒体等信息；复杂分录重录会显示提示，取消不会修改原记录。切回复式使用当前简易草稿，不恢复过期分录。自动折旧只能通过来源购买交易编辑；购买改为其他类型时一并撤销其自动折旧子交易，其他子交易保留。

账单详情的“更多 → 复制”调用 duplicateTransaction，在一次本地提交中新增完整账单，原交易保持不变。复制保留精确到毫秒的 time、可选 endTime、分录、备注、标签、图片和位置，根及全部子交易重新生成 ID、创建和修改时间，并重建父子引用。从子交易发起时复制其来源根账单，与编辑子交易的入口一致。

无 endTime 时按 time 单点记账；有 endTime 时表示排他区间 [time, endTime)，entries 保存整个期间的总金额。matchesTransactionDateRange 判断查询交集，getTransactionAmountInRange 用整数累计额取差分摊，完整期间各段严格加总为总额。图表消费领域聚合结果，不自行解释规则。

Transaction.children 保存完整递归子交易，parentTransactionId 指向直接父交易。IndexedDB 和备份只保存根交易。flattenTransactionTree 展开为领域计算集合，synchronizeTransactionChildren 从计算集合重建父级；拒绝重复 ID、循环、孤立引用及错误容器。统计与成本重放只遍历展开后的集合，每笔计算一次。编辑子交易通过 getTransactionEditTarget 打开根父交易。父交易删除仍受子交易完整性约束。

## 购买折旧与订阅摊销

每件物品由购买交易识别，可以共享“贵重物品”等资产账户，不要求单独建账户。fixed_asset / subscription 子类型用于分组，subscription 不可作为支付资源。折旧不使用账户级规则、累计折旧抵减账户或专用处置模型。

saveDepreciatingPurchase 原子保存资产购买及唯一的 depreciation 区间子交易。子交易借记折旧费用、贷记购买资产，总额为购买价减预计残值，time 为开始时间，endTime 为排他结束时间。默认查找对应币种的折旧费用账户，没有则创建；UI 的月份快捷设置通过 resolvePurchaseEndDate 相对购买日期计算绝对结束日期，不保存期限或残值副本。

编辑购买保留已有折旧子交易 ID 和创建时间，更新日期、金额与标签；子交易不复制购买备注。取消自动折旧只移除该子交易，其他关联记录保留。getPurchaseDepreciationState 根据购买及其区间子交易计算截至查询时间的累计费用和剩余价值。

自动折旧按账本自然日分摊，购买日确认一份费用，之后每日零点确认下一份，结束日期排他。普通手动区间交易按实际时长分摊。getAccountingHistoryThrough 投影截至查询时刻的已消耗部分；不会生成每日数据库交易。收支、资产余额与折旧图使用同一截止口径。状态筛选按期间末日判断使用中／已折旧完；新版尚未提供按物品自动处置损益或维修资本化。普通维修可作为关联购买的支出，不自动改写折旧。

## 外币与储值卡统一成本

充值卡是 prepaid 资产，具有专属货币 UUID；货币的 accountId 指向卡账户，两者 ID 不重合。其他资产不能复用其专属货币，费用和换汇平衡账户可使用。账户不保存余额或平均汇率，也不保存辅助面值。充值卡没有期初余额，实际充值建立余额与成本。

成本池账户用 currency 计量原币数量，costCurrency 计量投入成本。replayCurrencyCosts 按 time、createdAt、id 重放完整历史，getCurrencyCostBalance 返回剩余数量、成本与未知成本状态。消费成本＝消费数量×消费前剩余成本÷剩余数量；耗尽时取走全部剩余成本。充值将剩余与新增数量、成本分别相加，形成移动加权平均。

createCurrencyExchange / saveFundingTransaction 保存四条换汇分录，有手续费时增加费用分录。到账为充值卡时 type 为 topup，其他跨币种到账为 currency_exchange，普通同币种等额资产转入为 transfer。普通可编辑的支出、收入可在编辑器中切换为换汇／充值，表单和保存入口复用同一资格判断；转换沿用原交易 ID、创建时间、创建者、标签及图片／位置，替换原收支分录，不新增一笔重复交易。deriveCurrencyExchange 从分录及 currency_trading 权益子账户派生角色；成交比例为 received / (withdrawn - fee)，不保存 exchange 或汇率副本。手续费单独计费用，不加入本金。

createCurrencyExpense 保存两条同原币的费用与付款分录，创建或复用原费用分类对应的外币镜像账户。getCurrencyExpenseEstimate 提供发生前成本预览；recalculateCurrencyTransactions 在新增、补录、编辑、删除后重算完整候选历史。更新估算不改变 currency.amount 的原币扣款。透支或无效历史拒绝保存，缺少成本依据不猜测 1:1。

deriveExchangeRates 从剩余成本和数量推导双向比例，exchangeValueRate 支持交叉换算；不查询行情。同币种账户仍独立核算成本，设置页报价为聚合加权比例，不替代某个账户的成本。创建其他币种资产时自动启用多币种，原汇率页面管理主货币和快捷入口。

## 统计与原 UI

账户 UI 统一位于 `components/accounting/`：`account-manager.tsx` 包含账户列表和弹窗 Provider，`account-form.tsx` 编辑账户，`account-picker.tsx` 选择账户，`account-icon.tsx`、`account-icon-picker.tsx` 和 `account-icons.ts` 提供图标显示与选择。设置入口位于 `components/settings/accounts.tsx`。

原编辑器保留支出／收入／复式、金额键盘、备注、标签、时间、定位和图片。复式提供转账、还款、购入资产、换汇／充值、借款、手动折旧，最后为自由分录。主页面购买、转账和充值以灰色箭头展示；净资产变化从资产与负债分录派生。购买的子交易在其备注区域展示，详情列出全部账户的有符号原币变化。

分析页面使用 analysis.ts：先根据日期、备注、用户、标签、交易类型和关联账户筛选交易，再按筛选弹窗中多选的收入、费用、资产、负债、权益提取分录。收入和费用共同生成原有的收入、支出、结余汇总、收支趋势、日历、收入／支出结构图及明细；收支来源由账户类型决定，换汇手续费和折旧费用也纳入费用账户汇总，不要求交易 type 为 income 或 expense。资产、负债、权益有命中分录时分别提供期间增加、减少、净变动和对应图表。资产图表示筛选交易的期间变动，不将筛选结果当作完整资产余额。收入、负债、权益取贷方增加方向，资产、费用取借方增加方向。收支图当前选择的收入／支出／结余指标随视图保存。

未指定币种时直接使用 entry.amount，显示为无单位的统一金额；指定币种时仅保留 getEntryCurrency 匹配的分录，读取 currency.amount，没有 currency 的同币种分录读取 amount。分析不重新计算汇率、估算值或平均成本；金额范围也采用同一口径。折旧及其他区间分录按期间分摊，金额筛选针对完整查询期间的分录金额，趋势按自然日分配并保证累计金额守恒。折旧可从购买记录获取筛选元数据，不写入每日数据库记录。statisticsViews 保存账户类型、金额币种、其他条件及日期模式。

statistics.ts 保留收支汇总和完整余额查询；完整余额与成本重放继续读取截止历史，不用分析筛选结果替代成本基础。

## 备份、持久化和同步

数据管理中的单式账单导入、智能导入与 Oncent 导入统一先进入复式预览。用户必须选择未归档、允许收付款的资产或负债账户；importBillsToAccounting 按原分类的模板标识和币种复用或创建费用／收入账户，支出借记费用、贷记所选收付款账户：资产余额减少，负债余额增加；收入借记所选账户、贷记收入，退款生成负数费用以冲减原支出。预览按账户的正常余额方向显示净变动。只追加新的账单 ID，同一发生时间的不同 ID 均保留；已有 ID 跳过，不覆盖交易。预览不写库，确认时检查账本 ID 与 {writerSeq, repoSeq}，再通过一次 updateData 提交整批账户、交易和标签。币种不匹配或任一条目无效时整批拒绝。

微信智能导入使用 `components/data-manager/schemas/wechat.js` 的独立 `transform(file, ctx)` 脚本，支持官方 XLSX／XLS／CSV／TSV 文件，解析库通过 transform.worker.ts 随应用打包，运行时不访问 CDN；自动查找明细表头，按 UTC+8 读取时间并保留长交易单号。脚本为每条记录附加 `paymentMethod`，预览为每种支付方式分别选择收付款账户；未注明方式的记录单独选择，明确“已存入零钱”的收入归到零钱。各组分配后一次原子提交，writerSeq 只增加一次；普通未分组导入仍只选择一个收付款账户。收入方向的退款生成负数费用，原已退款支出保留；中性交易和未完成交易不自动导入，分类只做保守匹配，商户单号等保留在备注。

支付宝智能导入使用 `components/data-manager/schemas/alipay.js`，支持 XLSX／XLS、UTF-8 或 GBK CSV／TSV；动态查找“交易时间、收/支、交易订单号”表头，不依赖说明行数。时间按 UTC+8 解析，兼容无秒及单数字小时；金额精确转换为 10000 倍整数，订单号始终保留文本并用于重复导入去重。花呗可映射到负债账户；“花呗&红包”等组合方式保留独立分组与原文，不推算优惠和各来源分摊，整笔按明细金额记入用户所选账户。不计收支、关闭及失败交易不生成收支分录；已退款原支出保留，另列的收入退款冲减费用。分类优先识别明确食堂商品，再映射平台分类，未识别分类进入其他并保留原文。

旧 JSON／ZIP 的本地图片转换为交易内联图片，远程图片链接不会被静默丢弃。导出使用完整复式 JSON，包含账户、分录、图片和元数据；导入完整复式备份仍按独立账本恢复，保留原有平衡分录，不再按所选资产重复生成收支。

exportAccountingJson(accounts, transactions, tagMetadata?, mapConfig?, currencySettings?, statisticsViews?, timeZone?) 导出完整根交易与元数据。importAccountingJson 只接受 format: cent-accounting、schemaVersion: 17、amountScale: 10000；旧开发版本、未知字段和无效数据整份拒绝，不自动迁移。validateAccountingData 校验账户、原币平衡、树、区间、成本历史及元数据。交易不导出派生 currency、exchange、展示金额或规则副本。


当前账本使用 cent/<账本 ID> 独立 IndexedDB 库，仅保存 records 与 config。账本版本是从 syncState 取得的 {writerSeq, repoSeq} 快照，不再维护第三个计数。根交易、账户与序号原子提交；保存和冲突确认在同一写事务内检查双序号，任一变化则拒绝旧快照。广播只通知刷新，不能替代事务内的保存检查。store 串行提交完整候选，写入成功才更新可见状态。

本地保存与渲染优先：updateData 只等待 IndexedDB 提交，成功后立即更新视图，失败则保持原可见数据。网络同步使用独立队列与 syncing / syncError 状态，不占用本地 busy 队列；慢网和上传失败不阻塞继续编辑或切换账本。连续保存延迟 1 秒合并触发后台同步，同步中导入的通知在该轮结束后统一发出；完成时重新读取最新本地数据库，不直接应用上传前的返回快照。用户已切换账本时忽略旧轮次的界面刷新。网络失败保留待上传数据，后续可重试；实际因果冲突仍需确认完整版本。

启动时先读取上次选择的本地账本，不等待同步适配器、远端列表或网络校验；选择已有本地副本也不等待拉取。未指定当前账本时，选择页独立列出本地账本，离线或远端列表失败仍可打开；本地新建但未发布的账本同样可编辑。离线期间暂停自动同步，恢复网络后由 online 事件触发当前已绑定账本的增量同步。首次打开尚未下载的远端账本需要联网。生产 PWA 通过 Service Worker 预缓存应用资源，已完成缓存后支持断网重新打开页面。

账本通过 src/sync/accounting.ts 调用独立 packages/sync-sdk，api/endpoints/shared.ts 只负责端点和调度。当前支持 WebDAV、GitHub 与离线模式。同步使用 Writer 独立序号、因果上下文、Put-Wins、不可变批次和条件提交 Head；并发金额保留完整版本，解决冲突前不进入统计。根交易递归包含 children，业务校验复用本目录，详见 docs/sync-sdk-implementation.md。
