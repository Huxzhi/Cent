# IndexedDB + Manifest 分片同步 SDK

独立浏览器 TypeScript 模块，入口 @sync-sdk。一个数据库对应一个账本/数据集和一个自动生成的6位 writerId。支持离线使用、WebDAV、GitHub 和自定义 RemoteTransport。

本地只保留当前数据。远端按每设备1000个写入序号分片；更新同一个逻辑分片时，先上传新的不可变哈希文件，再条件更新 Manifest 指针，旧物理文件延迟清理。

## 使用

```ts
import { createSyncSDK } from '@glink25/sync-sdk'
const sdk = createSyncSDK({
  databaseName: 'my-notes-repo-v5',
  name: '我的笔记', // 写入远端 Manifest.name
  remote: {
    provider: 'github',
    owner: 'your-account',
    repo: 'your-data-repo',
    branch: 'main',
    path: 'my-app/repo-v4',
    token: 'from-credential-store',
  },
  garbageRetentionMs: 24 * 60 * 60 * 1000, // 可省略，默认24小时
})
const { id } = await sdk.store.put('notes', {
  value: { title: '离线编辑', time: Date.now() },
})
await sdk.sync.sync()
const page = await sdk.store.query({ collection: 'notes', limit: 200 })
await sdk.close()
```

name 可指定数据集名称，也可传入异步函数读取最新业务名称，例如 name: async () => currentBook.name。未指定时沿用远端名称，新数据集默认使用 databaseName。名称会在下次 sync 时条件更新，不重写分片，也不增加数据序号。

remote 可省略，通过 sync.setRemote 稍后设置。WebDAV 配置为 {provider:"webdav",url,username,password}。凭证由宿主管理，不进入记录或 Manifest。

## 本地数据库和序号

只有 records、config 两张表。records 主键是 [collection,id]，每个条目保存当前 value 和 \_sync；删除保留 value=null 的墓碑。config 保存同步状态、远端绑定、应用本地配置及必要的失败恢复引用，没有本地文件、批次或附件表。

```ts
{
    key: "syncState",
    writerId: "aB12cd",
    writerSeq: 730, // 最新本地记录写入事务序号，从0开始
    repoSeq: 56,   // 已完整导入的 Manifest 仓库版本，从0开始
    isSyncing: false, // 同数据库各页面共享的同步活动状态
    remote: { identity: "...", provider: "github", path: "..." },
}
```

每次成功的非空业务修改提交把 writerSeq 加1；单条写入、删除、批量写入、业务批量导入和冲突解决均按一次事务计数，同事务所有记录共用新序号，不按条目数递增。业务批量导入使用 store.putMany 或 store.batch：一次提交1200条记录也只加1，多次调用则各加1。回滚、仅配置写入、空批次、导出、远端同步导入和上传确认不增加 writerSeq；远端导入保留原 writerId/writerSeq。

本地没有独立 uploadedSeq。每次上传和竞争重试都先重新读取远端 Manifest，取当前 writerId 所有分片的最大 toSeq 为上次已发布序号 S。完整导入后捕获本地 writerSeq=N，仅上传本设备 S < writerSeq <= N 的当前记录。离线判断使用已导入 Manifest 缓存，不把尚未成功下载和导入的远端引用提前确认为已同步。

应用配置通过 sdk.config.get/set 或 store.batch 的 local 选项保存，键为 local/<key>。远端绑定只在 syncState.remote；config.bindRemote 支持原子首次绑定，不允许自动换到其它远端。

syncState.remote.identity 保存完整的远端标识，remote.path 保存相对于宿主配置目录的账本路径。完整路径不需要编码进 IndexedDB 数据库名；宿主可使用独立的短 ID 命名本地库。后续同步只更新 identity 时仍保留已有的 provider 和 path，不能把已绑定库换到另一路径。

同步操作按数据库名使用 Web Locks 排他执行，并在持锁后通过配置事务把 syncState.isSyncing 设为 true，结束时在 finally 中设回 false。同库其它页面的 config.getState().isSyncing 和 sync.getStatus().running 读取同一状态；状态写入不推进 writerSeq/repoSeq/revision，也不发送业务变化通知。本地业务编辑可以在同步期间继续提交，保留该状态。

布尔字段用于共享状态，实际互斥由 Web Locks 保证。页面关闭后浏览器释放锁；如果留下 true，下一次获得锁的操作会接管并在结束时清理，避免永久卡住。同步失败或状态清理失败会向调用方报错，可再次调用恢复。初始化仅补齐缺失的默认字段，不重置正在运行的 true；数据库结构及远端协议不变。自定义 SyncOptions.lock 必须同样按库名提供跨页面排他能力。sync、pull、cleanup、getWriters 及两种 files 操作复用此机制；手动网络传输跨多个函数的整体协调仍由宿主负责。

## 条目格式

```ts
{
    collection: "ledger", id: "bill-1",
    value: { amount: 100, time: 1000 },
    _sync: { writerId: "aB12cd", writerSeq: 730, repoSeq: 55 },
}
```

本地待上传条目的 repoSeq 是首次修改观察到的仓库基线；连续本地编辑和后续下载不会扩张该基线。生成新发布文件时，新修改的 repoSeq 写为实际发布版本；已在分片中的其它条目保留各自原来的发布版本。不能把分片中所有条目都改成文件的最新 repoSeq，否则会误报冲突或错误覆盖其它设备的数据。

writerId/writerSeq 表示修改来源，远端导入保持原样。业务 JSON 存在 value 中，业务自己的 id、collection、time、\_sync 不会覆盖 SDK 字段；**create_at、**update_at 仍属于业务数据。

默认按 ID 查询。orderBy:"time" 使用业务索引 [collection,value.time,id]；不含数值 time 的记录仍能按 ID 查询。查询支持方向、范围和游标，视图版本改变后旧游标失效。

## Manifest 与分片

完整 sync 在首次读取 manifest.json 返回404时自动创建文件，无需手动建文件：有待上传数据时直接创建首次发布的 Manifest；空数据集也创建包含 name 的空 Manifest（repoSeq=0、files=[]）。首次创建和更新都使用适配器的版本条件保护：标准 WebDAV 使用 If-None-Match:*/If-Match；无可用强 ETag 时自动使用服务器文件锁和内容哈希校验；遇到创建竞争重新读取并导入最新远端，不覆盖其它设备的发布。pull 仍为只读，不创建文件。如果本地已确认仓库版本大于0而远端 Manifest 丢失，继续报告 REMOTE_HISTORY_LOST，不把已同步仓库重置为空。

新建 Manifest 包含 name，读取旧的无名称 Manifest 仍受支持；名称和垃圾清理元信息的变化可在 repoSeq 不变时刷新本地 Manifest 缓存，不推进 writerSeq 或业务 revision。

```json
{
  "format": "record-repo",
  "version": 4,
  "name": "日常账本",
  "repoSeq": 56,
  "files": [
    {
      "writerId": "aB12cd",
      "fromSeq": 1,
      "toSeq": 730,
      "repoSeq": 56,
      "file": "chunks/aB12cd-000001-<sha256>.json.gz",
      "hash": "sha256:..."
    }
  ],
  "retired": []
}
```

同步按以下顺序执行：

1. 读取并校验远端 Manifest，确认已导入的分片历史没有丢失或回退。远端 repoSeq 大于本地已完整导入的 repoSeq 时，下载引用中 repoSeq 大于本地 repoSeq 的分片；全部校验并原子导入成功后，才推进本地 repoSeq。远端版本增加也可能来自本设备上次已发布但未完成本地确认的提交，不能仅据此判断为其它设备更新。
2. 远端 repoSeq 等于本地 repoSeq 时，无需下载新的业务数据，但仍要检查本地是否存在待上传修改。远端 repoSeq 小于本地已确认版本，或已确认的分片历史丢失、回退时，报错并停止同步；版本回退报 REMOTE_HISTORY_LOST，不能按普通上传失败处理，也不能自动用本地数据覆盖远端。
3. 完整导入后，取远端 Manifest 中本 writerId 所有分片的最大 toSeq 为已发布序号 S，并在本地只读事务中捕获 writerSeq=N 及本设备满足 S < writerSeq <= N 的当前记录。记录的 repoSeq 用于冲突基线和发布版本判断，不用于划分本地待上传范围。同步期间新提交的修改保留为后续待上传数据。
4. 按 writerSeq 的固定区间分组：1–1000、1001–2000，以此类推，区间起点为 floor((writerSeq - 1) / 1000) * 1000 + 1。若远端已有对应逻辑分片，读取其当前文件并合并本次修改；若没有，则创建新逻辑分片。只重建本次修改涉及的分片，保留其它记录原来的发布版本。
5. 生成上传计划时，以本次读取的远端 Manifest.repoSeq + 1 作为新发布版本：新分片文件顶层、本次修改记录的 _sync.repoSeq、新 Manifest 顶层及本次更新的分片引用均使用该版本，保留的旧记录和未更新分片的版本不变。例如远端为56，就先生成版本57的文件和 Manifest。先在本地保存发布恢复凭据，再上传新的不可变哈希文件，最后通过旧 Manifest 的版本令牌条件更新发布指针（ETag 或文件锁内的内容哈希校验）；只有指针提交成功，版本57才生效。条件更新竞争失败时，重新读取远端、导入更新并重新生成上传计划；若远端已变为57，新计划使用58，不会原地覆盖旧物理文件。发布成功后完成本地确认，被替换的物理文件进入 retired 队列，经过保留期后清理。

分片按事务序号区间划分，不按记录条数或字节数划分。对于以追加为主、较少修改历史记录的交易数据，已封闭且未受本次修改影响的分片不会重新下载或上传，因此历史大分片不会参与每次增量传输；本次仍在追加的逻辑分片会读取、合并并整体生成新文件。

## 冲突处理

采用记录级显式解决：本地存在待上传修改，且远端出现超过该修改原始基线的新版本时，保留本地修改和最新远端候选，等待用户选择。金额、账户等交易字段由用户确认，不按设备时间自动覆盖，也不自动相加。

冲突记录的 _sync.conflicted=true，_sync.versions[0] 是本地待上传版本，_sync.versions[1] 是当前保留的最新远端候选；候选的 value=null 表示删除。冲突记录对外的 value 也为 null，展示时必须根据 conflicted 区分冲突与删除，并从 versions 读取候选内容。这里只保留本地版本和最新远端候选，不提供完整历史或三方合并所需的基线值。

sync.sync() 发现待上传冲突时抛出 RECORD_CONFLICT，远端下载已完成，整个待上传批次暂停发布。可用 store.getConflicts() 获取冲突列表；普通 put/delete 不会隐式解决冲突。

```ts
import { SyncError } from '@glink25/sync-sdk'

try {
  await sdk.sync.sync()
} catch (error) {
  if (!(error instanceof SyncError) || error.code !== 'RECORD_CONFLICT') {
    throw error
  }
  const conflicts = await sdk.store.getConflicts()
  // 将 conflicts 展示给用户，进入下面的解决流程。
}
```

宿主为用户提供“保留本地”“采用远端”“手动合并”三个选项。下面的 choose 由宿主实现：展示两个候选并等待用户确认，分别返回 local.value、remote.value 或用户编辑后的完整业务值；返回 null 表示确认删除，取消时应抛出异常并退出保存流程。

```ts
import type { RecordVersion } from '@glink25/sync-sdk'

async function resolveConflict(
  collection: string,
  id: string,
  choose: (
    local: RecordVersion,
    remote: RecordVersion,
  ) => Promise<unknown | null>,
) {
  // 先刷新远端，再从同一个本地快照取得候选和 revision。
  await sdk.sync.pull()
  const { state, records } = await sdk.store.snapshot()
  const record = records.find(r => r.collection === collection && r.id === id)
  if (!record?._sync.conflicted) return

  const [local, remote] = record._sync.versions
  const value = await choose(local, remote)
  const options = { resolve: true as const, expectedRevision: state.revision }
  if (value === null) {
    await sdk.store.delete(collection, id, options)
  } else {
    await sdk.store.put(collection, { id, value }, options)
  }
  await sdk.sync.sync()
}
```

resolve: true 必须同时提供 expectedRevision，使用展示候选时的快照版本，不能在用户确认后重新读取 revision 再强行保存。缺少版本号，或等待用户期间本地业务数据变化、导入了新的远端数据时，保存会报 LOCAL_CONFLICT；宿主应重新加载候选并让用户再次确认。

解决结果作为本设备一次新的业务事务保存，writerSeq 加1，并以当前已导入的 repoSeq 为新基线；即使选择远端值，也通过新事务明确发布该选择。保存后仍需同步，若此时远端再次修改同一记录，会重新产生 RECORD_CONFLICT，宿主应刷新冲突列表继续处理。若还有其它未解决记录，整个批次仍暂停上传；可逐条解决后重试，或从同一快照收集全部选择，再通过 store.batch(changes, { resolve: true, expectedRevision }) 一次原子提交。

## WebDAV / OpenList

默认 concurrency: "auto"：首次上传检测真实的条件写入能力。强 ETag 可用且 If-Match/If-None-Match 正常时使用原生条件写入；缺失、弱 ETag、GET/PUT 的 ETag 不一致或服务忽略条件请求时，自动切换到 LOCK/UNLOCK 与 SHA-256 内容版本，无需强 ETag。可通过 createWebDAVTransport 或 remote 配置指定 concurrency: "etag" 强制原生模式，或 concurrency: "lock" 强制文件锁模式。

文件锁模式每次创建、覆盖或删除目标文件前，先获取服务器的独占锁，在锁内重新读取并核对内容哈希，再携带 If 锁令牌写入；创建时要求文件仍不存在。上传后回读校验，随后释放锁。锁申请有效期120秒；超时停止提交，服务器也必须拒绝已过期令牌。能力检测同时验证无令牌、错误令牌及解锁后旧令牌的请求会被拒绝。RemoteFile.etag 在此模式下是 sha256:... 版本令牌，宿主应将它作为不透明值原样传回。

OpenList 和中间代理需允许 LOCK/UNLOCK，转发 If、Lock-Token、Timeout 请求头。锁令牌和有效期可从响应头或 DAV XML 正文读取；跨域时可暴露 Lock-Token、Timeout，XML 正文也能作为浏览器的回退来源。原生 ETag 模式跨域需暴露 ETag。若两种并发保护方式都不可用，SDK 报 CAPABILITY 并停止发布 Manifest。

Manifest 的404按首次创建处理；200响应缺失 ETag 不会被当作文件不存在。本地 Web Locks 用于同数据库页面互斥；远端文件锁用于不同设备的条件写入，两者各自负责对应范围。
