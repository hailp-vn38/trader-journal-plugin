# Đánh giá hiệu năng và phương án tối ưu Trader Journal trên Obsidian

## Thông tin tài liệu

| Thuộc tính | Giá trị |
| --- | --- |
| Plugin | Trader Journal |
| Phiên bản được review | 1.2.2 |
| Ngày review | 2026-08-13 |
| Cập nhật sau kiểm chứng code | 2026-08-13 |
| Phạm vi | `src/`, cấu hình build, manifest và vòng đời plugin trong Obsidian |
| Trọng tâm | Startup, sự kiện vault, đọc/ghi file, index, React render, khả năng mở rộng |

## 1. Tóm tắt điều hành

Trader Journal hiện có nền tảng tương đối tốt cho một Obsidian community plugin:

- Phần lớn listener, timer và React root được cleanup đúng vòng đời.
- Dữ liệu journal/plan chỉ bắt đầu được index khi dashboard hoặc calendar cần sử dụng.
- Index sử dụng `vault.cachedRead()` thay vì đọc trực tiếp trong hầu hết luồng chỉ đọc.
- Việc lưu plugin data được tuần tự hóa bằng promise queue để tránh ghi đè do race condition.
- Economic calendar mặc định tắt, có cache và cooldown.
- Source không phụ thuộc Node/Electron API ở runtime, phù hợp với `isDesktopOnly: false`.
- Lint, TypeScript build, bundle validation và manifest validation đều đạt.

Tuy nhiên, kiến trúc cập nhật index hiện có một vấn đề quan trọng: sau khi dashboard hoặc calendar được mở lần đầu, thay đổi của **bất kỳ file nào trong vault** cũng có thể khiến plugin dựng lại snapshot của toàn bộ trade và plan. Chi phí này tăng theo số trade, số plan và số ngày tồn tại của plan.

Các ưu tiên xử lý:

1. Lọc vault event trước khi đưa vào hàng đợi cập nhật.
2. Không dựng snapshot hoặc notify UI khi file không liên quan.
3. Không coi plan nằm trong `Trading/Live/_plans` là journal.
4. Thay cách materialize plan theo từng ngày bằng truy vấn theo khoảng ngày hiển thị.
5. Dùng index dùng chung cho lookup setup/plan thay vì quét lại file.
6. Giới hạn số file được đọc đồng thời khi rebuild.

### 1.1. Hiệu chỉnh sau khi kiểm chứng trực tiếp code

Các kết luận chính của review được xác nhận, nhưng cần làm rõ thêm:

- Modify một file ngoài các root Trader Journal hiện thường đã có `cachedReadCount = 0`. Vấn đề còn lại là trade snapshot và plan snapshot vẫn được dựng lại, subscriber vẫn được notify và React vẫn nhận object mới. Vì vậy benchmark bắt buộc phải đo thêm `snapshotBuildCount`, snapshot identity và `subscriberNotifyCount`; chỉ đo file read là chưa đủ.
- Giới hạn `MAX_INDEXED_PLAN_DAYS = 730` không chỉ gây tốn bộ nhớ. Open plan cũ hơn 730 ngày chỉ xuất hiện trong 730 ngày đầu và có thể biến mất khỏi ngày hiện tại. Range-based calendar vì vậy đồng thời là bản sửa correctness.
- Path classifier không được dựa vào thứ tự loại cố định như plan trước setup. Khi các root do người dùng cấu hình chồng lấn, classifier phải chọn root khớp cụ thể nhất theo độ dài path và xử lý trường hợp hai root giống hệt nhau.
- Rename/delete folder và timer đang chờ theo path phải được xử lý bằng prefix. Đây là yêu cầu correctness và phải nằm trong nhóm quick wins.
- `JournalPlanIndex` hiện là projection cho calendar, không nên mặc nhiên trở thành nguồn canonical cho mọi lookup. Repository phải lưu canonical parsed entry rồi tạo projection riêng cho UI.
- `syncGraphTypeTags()` enumerate toàn vault nhưng chủ yếu tra metadata cache đối với file không liên quan. Đây vẫn là startup work cần giới hạn, nhưng có ưu tiên thấp hơn event routing, snapshot và lookup index.

Sau giai đoạn quick wins, hành vi mong muốn là:

```text
Sửa note không thuộc Trader Journal
        │
        ├── Không đọc journal/plan file
        ├── Không dựng lại snapshot
        └── Không render lại dashboard/calendar
```

## 2. Kiến trúc hiện tại

### 2.1. Vòng đời khởi động

`src/main.ts` thực hiện các tác vụ chính sau:

1. Đọc và chuẩn hóa settings.
2. Khởi tạo `EconomicCalendarService`.
3. Khởi tạo `JournalDataService` nhưng chưa build index ngay.
4. Đăng ký ribbon, view, command, Markdown code block processor và setting tab.
5. Khi layout sẵn sàng:
   - Đăng ký auto rebuild thống kê journal.
   - Chạy đồng bộ Graph tags.

Việc trì hoãn journal index cho đến khi có subscriber là quyết định tốt. Phần cần tối ưu là listener sau khi index đã được khởi động và tác vụ quét Graph tags khi load.

### 2.2. Luồng dữ liệu dashboard/calendar

```text
Dashboard hoặc Calendar mở
        │
        ▼
JournalDataService.subscribe()
        │
        ├── JournalCalendarIndex.rebuild()
        │       └── Đọc các journal file
        │
        └── JournalPlanIndex.rebuild()
                └── Đọc các plan file

Vault create/modify/delete/rename
        │
        ▼
JournalDataService
        │
        ├── update trade index
        ├── update plan index
        ├── dựng lại snapshot
        └── notify mọi subscriber
```

### 2.3. Luồng auto rebuild thống kê

```text
Journal file được modify
        │
        ▼
Debounce 800 ms
        │
        ▼
rebuildDailyNoteStats()
        │
        ├── Đọc toàn bộ journal note
        ├── Parse trade blocks
        ├── Quét setup để tạo setupLinks
        ├── Lookup plan để tạo planLinks
        ├── Tính lại thống kê
        └── Có thể ghi body/frontmatter
```

## 3. Vấn đề 1: xử lý event của toàn vault

### 3.1. Hiện trạng

`JournalDataService.start()` đăng ký `create`, `modify`, `delete` và `rename` trên toàn bộ vault. Với `create` và `modify`, mọi `TFile` đều được chuyển vào `scheduleFileUpdate()`.

Sau debounce 250 ms, `updateFile()` luôn gọi đồng thời:

- `tradeIndex.updateFile(file)`;
- `planIndex.updateFile(file)`.

Mỗi index xóa path khỏi map, kiểm tra file có thuộc phạm vi của mình hay không, sau đó vẫn gọi `getSnapshot()`. `getSnapshot()` không phải thao tác hằng số; nó duyệt lại toàn bộ entries và sắp xếp dữ liệu.

### 3.2. Tác động trong Obsidian

Sau khi dashboard/calendar từng được mở:

- Chỉnh sửa một note học tập hoặc note cá nhân không liên quan vẫn làm plugin chạy.
- Autosave của editor có thể liên tục kích hoạt debounce.
- Trade snapshot và plan snapshot được tạo object mới.
- Subscriber nhận object mới và React chạy lại render/memo selectors.
- Khi không còn dashboard/calendar mở, listener vẫn tồn tại vì `started` không trở về `false`.

Chi phí gần đúng cho mỗi lần cập nhật:

```text
O(T + P × D + sorting)
```

Trong đó:

- `T`: tổng số trade đã index;
- `P`: tổng số plan;
- `D`: số ngày trung bình một plan được materialize.

### 3.3. Nguyên nhân gốc

- Lọc phạm vi diễn ra quá muộn, bên trong từng index.
- `updateFile()` luôn trả một snapshot mới, kể cả khi map không thay đổi.
- Service không phân biệt event liên quan và không liên quan.
- Service không dừng khi subscriber cuối cùng unmount.

### 3.4. Phương án quick win

Tạo một module phân loại path dùng chung, ví dụ `src/journal/pathScope.ts`:

```ts
export type TraderJournalFileKind = 'journal' | 'plan' | 'setup' | 'unrelated';

export function classifyTraderJournalPath(
	plugin: TraderJournalPlugin,
	path: string,
): TraderJournalFileKind {
	// Kiểm tra root cụ thể trước vì plan nằm bên trong live root.
	if (isPathInFolder(path, getPlanRootFolder(plugin))) {
		return 'plan';
	}

	if (isPathInFolder(path, getSetupRootFolder(plugin))) {
		return 'setup';
	}

	if (
		isPathInFolder(path, plugin.settings.journalFolder) ||
		isPathInFolder(path, plugin.settings.liveJournalFolder)
	) {
		return 'journal';
	}

	return 'unrelated';
}
```

Nguyên tắc quan trọng: root cụ thể hơn phải được kiểm tra trước root cha. Vì mọi root đều có thể được cấu hình, implementation cuối cùng phải tìm tất cả root khớp rồi chọn root có normalized path dài nhất, thay vì phụ thuộc vào thứ tự `if` cố định. Nếu nhiều loại có cùng root, settings phải báo cấu hình mơ hồ hoặc áp dụng một quy tắc tie-break được test rõ ràng.

Thay đổi event handling:

```ts
private scheduleFileUpdate(file: TFile): void {
	const kind = classifyTraderJournalPath(this.plugin, file.path);
	if (kind !== 'journal' && kind !== 'plan') {
		return;
	}

	// Tiếp tục debounce theo path.
}
```

Với rename phải xét cả path cũ và path mới:

```ts
const oldKind = classifyTraderJournalPath(plugin, oldPath);
const newKind = classifyTraderJournalPath(plugin, file.path);

if (oldKind === 'unrelated' && newKind === 'unrelated') {
	return;
}
```

Với delete, chỉ dựng snapshot nếu `removePath()` thực sự xóa một entry:

```ts
removePath(path: string): JournalCalendarSnapshot | null {
	if (!this.entriesByPath.delete(path)) {
		return null;
	}

	return this.rebuildSnapshot();
}
```

### 3.5. Phương án hoàn chỉnh

Mỗi index nên giữ snapshot hiện tại và chỉ tạo snapshot mới khi state thay đổi:

```ts
class JournalCalendarIndex {
	private snapshot = EMPTY_TRADE_SNAPSHOT;

	getSnapshot(): JournalCalendarSnapshot {
		return this.snapshot;
	}

	async updateFile(file: TFile): Promise<boolean> {
		if (!this.isRelevant(file) && !this.entriesByPath.has(file.path)) {
			return false;
		}

		// Cập nhật entry và snapshot.
		return true;
	}
}
```

`JournalDataService` chỉ notify khi ít nhất một index trả về `changed === true`.

### 3.6. Dừng listener khi không còn subscriber

Có hai lựa chọn:

#### Lựa chọn A: giữ service chạy nhưng lọc event chặt

Ưu điểm:

- Khi mở lại dashboard, dữ liệu đã cập nhật.
- Logic đơn giản.

Nhược điểm:

- Vẫn giữ listener suốt vòng đời plugin.

Đây là lựa chọn phù hợp sau khi event không liên quan đã có chi phí bằng 0.

#### Lựa chọn B: reference-count lifecycle

Khi `subscribers.size === 0`:

- Gỡ vault event refs;
- Hủy timer;
- Đánh dấu index cần rebuild khi có subscriber mới.

Ưu điểm là không còn background work. Nhược điểm là mở lại view cần rebuild. Nên chỉ triển khai nếu profiling cho thấy lựa chọn A vẫn còn chi phí đáng kể.

## 4. Vấn đề 2: materialize plan theo từng ngày

### 4.1. Hiện trạng

`JournalPlanIndex.getSnapshot()` gọi `getPlanDisplayDates(plan)` cho từng plan. Hàm này tạo một array ngày từ `startDate` đến `endDate`, hoặc đến hôm nay nếu plan còn mở, tối đa 730 ngày.

Mỗi ngày lại chứa một reference đến plan và danh sách của từng ngày được sort.

Giới hạn 730 ngày hiện còn tạo lỗi chức năng: plan `open` bắt đầu hơn 730 ngày trước không được materialize đến hôm nay. Query theo visible range phải cắt interval theo range đang hiển thị, không cắt 730 ngày kể từ `startDate`.

### 4.2. Tăng trưởng dữ liệu

Giả sử mọi plan đều mở đủ lâu để đạt giới hạn 730 ngày:

| Số plan | Số plan-day references tối đa |
| ---: | ---: |
| 10 | 7.300 |
| 50 | 36.500 |
| 100 | 73.000 |
| 500 | 365.000 |

Các con số trên chưa bao gồm object ngày, array, sort và React selector phía UI.

### 4.3. Phương án đề xuất

Không lưu `daysByDate` cho toàn bộ lịch sử. Index chỉ lưu plan dưới dạng interval:

```ts
interface IndexedPlanInterval {
	plan: JournalCalendarPlan;
	startDate: string;
	endDate: string | null;
}
```

Calendar yêu cầu dữ liệu cho khoảng đang hiển thị:

```ts
getPlanDaysInRange(startDate: string, endDate: string): Record<string, JournalCalendarPlanDay>
```

Month calendar thường chỉ cần 35–42 ngày. Horizontal calendar chỉ cần số ngày của tháng hiện tại. Như vậy chi phí materialize được giới hạn theo vùng UI đang hiển thị:

```text
O(P × visibleDays)
```

thay vì:

```text
O(P × planLifetimeDays)
```

### 4.4. Phương án chuyển đổi ít rủi ro

Giai đoạn đầu chưa cần thay public snapshot hoàn toàn:

1. Giữ `plans` là danh sách canonical.
2. Bỏ `daysByDate` và `dayDates` toàn lịch sử khỏi snapshot hoặc đánh dấu deprecated.
3. Thêm selector thuần:

```ts
createPlanDaysForRange(plans, rangeStart, rangeEnd)
```

4. Calendar dùng `useMemo()` theo `visibleMonth`.
5. Dashboard tiếp tục dùng trực tiếp `plans` và không materialize ngày.

### 4.5. Lưu ý chức năng

Các hành vi phải được giữ nguyên:

- Plan `open`: hiển thị từ ngày bắt đầu đến ngày hiện tại.
- Plan `closed`/`cancelled` có `endDate`: hiển thị đến ngày kết thúc.
- Plan không có `endDate`: fallback theo quy tắc hiện tại.
- Không hiển thị ngày trước `startDate`.
- Phải xử lý timezone theo local calendar date, không dùng UTC làm thay đổi ngày.

## 5. Vấn đề 3: plan folder bị coi là journal folder

### 5.1. Hiện trạng

Settings mặc định:

```text
liveJournalFolder = Trading/Live
planFolder        = Trading/Live/_plans
```

`isPotentialJournalFile()` hiện kiểm tra file Markdown có nằm dưới journal root hay không. Vì plan root là con của live root, mọi plan file đều được coi là potential journal file.

### 5.2. Tác động

- Trade index đọc plan file rồi mới phát hiện không có trade block.
- Plan index đọc lại chính file đó.
- Auto stats rebuild được schedule khi plan file thay đổi.
- Các Markdown note khác đặt dưới live root cũng chịu hành vi tương tự.

### 5.3. Phương án xử lý

Tách hai khái niệm:

- `isPathInJournalRoot()`: kiểm tra phạm vi path thô.
- `isJournalCandidate()`: path thuộc journal root nhưng không thuộc reserved subfolder.

```ts
function isJournalCandidate(plugin: TraderJournalPlugin, file: TFile): boolean {
	if (file.extension !== 'md') {
		return false;
	}

	const kind = classifyTraderJournalPath(plugin, file.path);
	return kind === 'journal';
}
```

Reserved paths tối thiểu:

- Plan folder;
- Setup folder nếu người dùng cấu hình lồng nhau;
- Attachment folder của plugin;
- Các root tính năng tương lai.

Đối với file đã tồn tại, có thể xác nhận thêm bằng `metadataCache`:

```ts
const type = metadataCache.getFileCache(file)?.frontmatter?.type;
return type === BACKTEST_NOTE_TYPE || type === LIVE_NOTE_TYPE;
```

Không nên chỉ dựa vào metadata cho file vừa tạo, vì metadata cache có thể chưa cập nhật. Cách an toàn là path classification trước, metadata/type sau.

## 6. Vấn đề 4: lookup setup/plan quét file lặp lại

### 6.1. Hiện trạng

Khi rebuild daily stats, plugin cần tạo Graph links:

- `setup_id` được resolve bằng cách đọc toàn bộ setup files.
- Mỗi `plan_id` gọi `getTradePlanById()`.
- Mỗi lần `getTradePlanById()` lại đọc toàn bộ plan files.

Nếu một journal có `k` plan ID, `S` setup và `P` plan, số file read gần:

```text
S + k × P
```

### 6.2. Phương án kiến trúc

Tạo index dùng chung theo ID:

```ts
interface ReferenceIndexSnapshot {
	setupsById: ReadonlyMap<string, TradeSetupDefinition>;
	plansById: ReadonlyMap<string, TradePlanFileEntry>;
}
```

Các API lookup:

```ts
getSetupById(id: string): TradeSetupDefinition | null;
getPlanById(id: string): TradePlanFileEntry | null;
listSetups(): readonly TradeSetupDefinition[];
listPlans(): readonly TradePlanFileEntry[];
```

Index được cập nhật incrementally theo create/modify/delete/rename đã lọc path.

### 6.3. Tái sử dụng index hiện có

`JournalPlanIndex` đã giữ `entriesByPath`, nên có thể bổ sung `plansById` thay vì tạo hệ thống hoàn toàn mới. Setup hiện chưa có index lâu dài, vì vậy nên tạo `SetupIndex` tương tự.

`JournalDataService` hoặc một `TraderJournalRepository` mới có thể sở hữu ba index:

```text
TraderJournalRepository
  ├── TradeIndex
  ├── PlanIndex
  └── SetupIndex
```

Tất cả modal, dashboard, stats rebuild và block processor dùng repository thay vì tự scan folder.

### 6.4. Fallback khi index chưa sẵn sàng

Các lựa chọn:

1. `ensureStarted()` và chờ initial index build.
2. Dùng metadata cache để lookup nhanh trước.
3. Chỉ scan một lần rồi cache nếu repository chưa được khởi động.

Khuyến nghị dùng `ensureStarted()` với một shared promise để nhiều caller không khởi động nhiều rebuild đồng thời:

```ts
private startPromise: Promise<void> | null = null;

ensureStarted(): Promise<void> {
	this.startPromise ??= this.rebuildAll();
	return this.startPromise;
}
```

## 7. Vấn đề 5: đọc đồng thời không giới hạn

### 7.1. Hiện trạng

Các index/list function sử dụng mẫu:

```ts
await Promise.all(files.map((file) => readFile(file)));
```

Điều này nhanh với vài chục file nhưng có thể tạo hàng trăm hoặc hàng nghìn promise/read request cùng lúc.

### 7.2. Rủi ro

- Peak memory tăng.
- Event loop có nhiều microtask.
- Mobile dễ bị ảnh hưởng hơn desktop.
- UI có thể giật trong initial build.
- Một file lỗi không được phép làm mất toàn bộ batch; hiện từng `readFileEntry()` đã catch lỗi, đây là điểm tốt cần giữ.

### 7.3. Phương án

Không thêm dependency chỉ để giới hạn concurrency. Tạo helper nhỏ trong `src/utils/async.ts`:

```ts
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index], index);
		}
	}

	const workerCount = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}
```

Mức khởi đầu đề xuất:

- Desktop: 12–16;
- Mobile: 6–8;
- Hoặc dùng cố định 8 để đơn giản và ổn định.

Cần benchmark trước khi chọn số cuối cùng.

## 8. Vấn đề 6: auto rebuild thống kê quá rộng

### 8.1. Hiện trạng

Auto rebuild dùng debounce theo file 800 ms. Đây là điểm tốt, nhưng:

- Predicate journal hiện quá rộng.
- Rebuild vẫn đọc và parse cả file nếu nội dung không liên quan đến trade data.
- Modify do chính plugin ghi summary/frontmatter có thể tạo thêm event.
- Một rebuild đang chạy không ngăn rebuild mới cùng path bắt đầu sau đó.

### 8.2. Phương án

#### Bước 1: dùng journal predicate chính xác

Chỉ schedule file được phân loại là journal.

#### Bước 2: queue theo path

Đảm bảo mỗi path chỉ có tối đa một rebuild đang chạy:

```ts
const runningByPath = new Map<string, Promise<void>>();
```

Nếu có modify mới trong lúc đang chạy, đánh dấu `dirty` và chạy thêm đúng một lần sau khi task hiện tại kết thúc.

#### Bước 3: tránh self-trigger không cần thiết

Chỉ ghi content/frontmatter khi giá trị mới khác giá trị hiện tại. Code hiện đã có so sánh metadata và content, cần giữ nguyên.

Có thể bổ sung suppression ngắn cho path do plugin vừa ghi, nhưng không được bỏ qua chỉnh sửa thực sự của người dùng. Queue + equality check an toàn hơn suppression dựa thuần vào thời gian.

#### Bước 4: dùng reference index

Graph link resolution phải dùng lookup O(1) từ index thay vì scan file.

### 8.3. Debounce đề xuất

800 ms hiện hợp lý. Không nên tăng debounce trước khi xử lý nguyên nhân gốc vì chỉ trì hoãn công việc, không giảm độ phức tạp. Sau khi tối ưu, có thể giữ 800 ms hoặc benchmark khoảng 500–1.000 ms.

## 9. Vấn đề 7: quét toàn vault khi đồng bộ Graph tags

### 9.1. Hiện trạng

`syncGraphTypeTags()` gọi `vault.getMarkdownFiles()` mỗi lần plugin load rồi kiểm tra metadata của mọi Markdown file.

Điều này tương ứng với Obsidian review concern về **Vault Enumeration**: plugin chạm tới danh sách path của toàn vault dù chỉ cần các folder do Trader Journal quản lý.

### 9.2. Phương án ưu tiên

Chỉ traverse bốn root được cấu hình:

- Backtest journal;
- Live journal, có loại trừ reserved folders;
- Plan;
- Setup.

Sử dụng `TFolder.children` để enumerate phạm vi nhỏ thay vì `getMarkdownFiles()`.

### 9.3. Biến tác vụ thành migration có phiên bản

Graph tag sync là migration dữ liệu, không cần chạy toàn bộ ở mọi startup.

Thêm vào plugin data:

```ts
interface TraderJournalPluginData {
	settings: TraderJournalSettings;
	dataMigrationVersion: number;
	// Các trường cache hiện có.
}
```

Luồng:

```text
Nếu dataMigrationVersion < GRAPH_TAG_MIGRATION_VERSION
        │
        ├── Chạy scoped migration
        ├── Ghi version mới khi hoàn tất
        └── Không quét lại ở lần load sau
```

Nếu cần hỗ trợ note mới do người dùng tạo thủ công, xử lý bằng event incremental trong các root liên quan thay vì quét lại toàn vault.

### 9.4. UX và an toàn dữ liệu

Nếu migration có thể sửa nhiều file:

- Chạy sau layout ready.
- Yield giữa các batch để tránh khóa UI.
- Không hiện Notice cho từng file.
- Log lỗi có path nhưng tiếp tục các file còn lại.
- Chỉ sửa file có `type` thuộc tập Trader Journal đã biết.

## 10. Vấn đề 8: lưu settings theo từng ký tự

### 10.1. Hiện trạng

Các input folder cập nhật `plugin.settings` và gọi `saveSettings()` trong mỗi `onChange`. Khi người dùng nhập một path dài, plugin tạo nhiều tác vụ `saveData()` nối tiếp nhau.

`persistData()` còn serialize cả economic calendar cache cùng settings.

### 10.2. Phương án

- `onChange`: chỉ cập nhật React local state.
- `onBlur` hoặc Enter: normalize, cập nhật plugin settings và lưu một lần.
- Có thể debounce 300–500 ms nếu muốn lưu trong khi nhập.
- Chỉ gọi `journalDataService.refreshIfStarted()` khi path thực sự thay đổi.

Ví dụ:

```ts
const commitJournalFolder = async () => {
	const normalized = normalizePath(journalFolder.trim());
	if (!normalized || normalized === plugin.settings.journalFolder) {
		return;
	}

	plugin.settings.journalFolder = normalized;
	await plugin.saveSettings();
	await plugin.journalDataService.refresh();
};
```

Nên tách settings và economic cache thành hai logical payload nếu cache tiếp tục tăng, nhưng đây không phải thay đổi bắt buộc ở quy mô hiện tại.

## 11. Bundle và React

### 11.1. Hiện trạng

Production bundle đo được tại thời điểm review:

| Artifact | Kích thước gần đúng |
| --- | ---: |
| `main.js` | 312 KB |
| `main.js` gzip | 88 KB |
| `styles.css` | 46 KB |

Bundle sử dụng React production. Kích thước này chấp nhận được cho UI có nhiều modal/dashboard/calendar, nhưng toàn bộ code UI vẫn được parse khi plugin load.

### 11.2. Khuyến nghị

Đây chưa phải ưu tiên cao. Chỉ tối ưu bundle sau khi xử lý event/index vì I/O và snapshot rebuild gây tác động lớn hơn parse 312 KB.

Các lựa chọn nếu cần:

- Tách component lớn thành module để maintain, dù esbuild vẫn bundle thành một file.
- Loại helper hoặc bản dịch không sử dụng bằng tree-shaking.
- Kiểm tra bundle analyzer trước khi thay React hoặc thêm cơ chế phức tạp.
- Không tạo runtime chunk bổ sung vì Obsidian release artifact cần đơn giản và ổn định.

## 12. Kiến trúc đích đề xuất

```text
TraderJournalPlugin
  │
  ├── SettingsService
  │     └── Lưu settings có debounce/commit
  │
  ├── TraderJournalRepository
  │     ├── PathScope
  │     ├── TradeIndex
  │     ├── PlanIndex
  │     ├── SetupIndex
  │     └── Vault event router
  │
  ├── StatsRebuildService
  │     ├── Debounce theo path
  │     ├── Queue theo path
  │     └── Lookup graph links từ repository
  │
  ├── Dashboard view
  │     └── Subscribe snapshot canonical
  │
  └── Calendar view
        └── Materialize plan days theo visible range
```

### 12.1. Event router

Một listener set duy nhất phân loại event rồi chuyển đến đúng index:

```text
Vault event
   │
   ▼
classify path
   │
   ├── journal ──► TradeIndex + StatsRebuildService
   ├── plan ─────► PlanIndex
   ├── setup ────► SetupIndex
   └── unrelated ► return
```

Điều này tránh mỗi feature tự đăng ký listener toàn vault và tránh logic scope bị lệch giữa các module.

### 12.2. Snapshot identity

Nếu dữ liệu không thay đổi, giữ nguyên reference của snapshot. React dựa vào reference equality để tránh render/memo computation không cần thiết.

Quy tắc:

- Unrelated event: không notify.
- Relevant event nhưng nội dung parse ra giống entry cũ: không notify.
- Chỉ `isLoading` đổi khi full rebuild thực sự bắt đầu/kết thúc.
- Batch nhiều event gần nhau thành một lần notify nếu có thể.

### 12.3. Data ownership

Mỗi file chỉ nên được parse một lần cho mỗi modify event. Kết quả parse được lưu thành canonical entry và được các feature khác sử dụng lại.

Không nên có các luồng độc lập cùng đọc lại toàn bộ folder cho:

- Modal options;
- Dashboard;
- Graph links;
- Calendar;
- Block processor lookup.

## 13. Lộ trình triển khai

### Giai đoạn 1: quick wins, rủi ro thấp

1. Tạo `pathScope.ts`.
2. Lọc create/modify/delete/rename trong `JournalDataService`.
3. Loại plan/setup/attachment roots khỏi journal predicate.
4. Không tạo snapshot mới nếu entry map không thay đổi.
5. Chỉ notify khi có thay đổi.
6. Chuyển settings path sang commit on blur.
7. Thêm unit tests cho nested roots và unrelated events.

Kết quả kỳ vọng: chỉnh sửa note ngoài Trader Journal có chi phí gần bằng 0.

### Giai đoạn 2: tối ưu index

1. Thêm `plansById`.
2. Tạo `SetupIndex` và `setupsById`.
3. Chuyển modal và graph link resolution sang shared index.
4. Giới hạn concurrency initial read.
5. Queue stats rebuild theo path.

Kết quả kỳ vọng: một journal modify không còn quét toàn bộ setup/plan folder.

### Giai đoạn 3: range-based calendar

1. Bỏ plan-day materialization toàn lịch sử.
2. Thêm query theo range.
3. Calendar chỉ tạo ngày cho visible month.
4. Giữ dashboard dựa trên canonical `plans` list.
5. Benchmark plan dài hạn và navigation qua nhiều tháng.

Kết quả kỳ vọng: chi phí plan không còn tỷ lệ với tuổi của plan.

### Giai đoạn 4: migration và startup

1. Thay full-vault Graph tag scan bằng scoped traversal.
2. Thêm migration version.
3. Batch/yield migration writes.
4. Đo plugin startup và layout ready work.

## 14. Kế hoạch kiểm thử

### 14.1. Unit tests

#### Path classification

- Journal backtest path trả `journal`.
- Journal live path trả `journal`.
- Plan path lồng trong live root trả `plan`, không trả `journal`.
- Setup path trả `setup`.
- Attachment path trả `unrelated` hoặc loại phù hợp riêng.
- File ngoài các root trả `unrelated`.
- Root có hoặc không có dấu `/` cuối cho kết quả giống nhau.
- Rename từ journal ra ngoài và từ ngoài vào journal được nhận đúng.

#### Index update

- Unrelated file không gọi `cachedRead()`.
- Unrelated file không thay snapshot reference.
- Unrelated file không notify subscriber.
- Delete path không tồn tại không dựng snapshot.
- Modify journal chỉ cập nhật trade index.
- Modify plan chỉ cập nhật plan index.
- Nội dung parse giống entry cũ không notify.

#### Plan range

- Plan open hiển thị đến hôm nay.
- Closed plan dừng ở end date.
- Range không giao plan trả rỗng.
- Range giao một phần chỉ trả ngày giao nhau.
- Ngày leap year và chuyển tháng hoạt động đúng.
- Giữ giới hạn an toàn cho dữ liệu end date bất thường.

#### Stats rebuild

- Nhiều modify liên tiếp cùng path được coalesce.
- Không có hai rebuild cùng path chạy đồng thời.
- Modify do ghi frontmatter không tạo vòng lặp vô hạn.
- Lookup setup/plan dùng index và không enumerate folder.

### 14.2. Integration tests với mock Obsidian API

Theo dõi các counter:

```ts
interface PerformanceCounters {
	cachedReadCount: number;
	vaultReadCount: number;
	processCount: number;
	frontmatterWriteCount: number;
	snapshotBuildCount: number;
	snapshotIdentityChangeCount: number;
	subscriberNotifyCount: number;
	calendarRenderCount: number;
}
```

Kịch bản quan trọng nhất:

```text
Given dashboard index đã sẵn sàng
When một note ngoài Trading được modify
Then cachedReadCount tăng 0
And snapshotBuildCount tăng 0
And subscriberNotifyCount tăng 0
And không có snapshot mới
```

Lưu ý: điều kiện `cachedReadCount tăng 0` có thể đã đạt trước khi tối ưu đối với note nằm ngoài toàn bộ configured roots. Hai điều kiện phân biệt regression quan trọng nhất là không dựng snapshot và không notify subscriber.

### 14.3. Manual test trong Obsidian

1. Mở dashboard và calendar.
2. Đóng cả hai view.
3. Chỉnh sửa note ngoài Trader Journal liên tục.
4. Kiểm tra console không có log/rebuild liên quan.
5. Mở lại dashboard và xác nhận dữ liệu đúng.
6. Tạo, sửa, rename và delete journal/plan/setup.
7. Kiểm tra dashboard/calendar cập nhật đúng một lần.
8. Reload và disable/enable plugin nhiều lần để kiểm tra listener leak.
9. Kiểm tra trên mobile nếu có môi trường iOS/Android.

## 15. Kế hoạch benchmark

### 15.1. Dataset tổng hợp

Không dùng dữ liệu vault cá nhân cho benchmark tự động. Tạo fixture tổng hợp:

| Profile | Unrelated notes | Journal files | Trades | Plans | Setups |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small | 100 | 50 | 250 | 20 | 10 |
| Medium | 2.000 | 500 | 5.000 | 200 | 50 |
| Large | 10.000 | 2.000 | 20.000 | 1.000 | 200 |

Plan fixture cần có:

- Plan mới mở;
- Plan mở hơn 730 ngày;
- Plan đã đóng;
- Plan qua ranh giới tháng/năm;
- Plan có nhiều linked trades.

### 15.2. Chỉ số cần đo

- Thời gian `onload()`.
- Thời gian initial repository build.
- Số file read trong initial build.
- Số file read khi modify note ngoài scope.
- Số file read khi modify một journal.
- Thời gian từ vault event đến snapshot sẵn sàng.
- Số subscriber notifications cho một thao tác.
- Peak heap trong initial build.
- Thời gian render calendar tháng.
- Thời gian chuyển tháng.

### 15.3. Mục tiêu nghiệm thu

Các ngưỡng dưới đây là mục tiêu kỹ thuật, cần xác nhận trên máy desktop phổ thông:

| Kịch bản | Mục tiêu |
| --- | --- |
| Modify note ngoài scope | 0 journal/plan/setup reads |
| Modify note ngoài scope | 0 subscriber notifications |
| Modify một plan | Không đọc toàn bộ journal folder |
| Modify một journal | Không quét toàn bộ plan/setup folder |
| Initial index | Concurrency không vượt giới hạn cấu hình |
| Calendar plan data | Chỉ materialize visible range |
| Listener cleanup | Không tăng sau mỗi lần enable/disable plugin |
| Build/lint/manifest | Tiếp tục đạt |

Mục tiêu latency tham khảo cho dataset medium:

- Relevant single-file update: dưới 50 ms CPU work, không tính debounce.
- Chuyển tháng calendar: dưới 50 ms.
- UI không có long task trên 100 ms trong thao tác bình thường.

Không nên coi các số này là cam kết trước khi có benchmark baseline.

### 15.4. Benchmark sau triển khai

Benchmark tổng hợp có thể chạy lại bằng:

```bash
npm run benchmark
```

Kết quả trên máy review với 1.000 open plan, mỗi plan bắt đầu từ 2020, `today = 2026-08-13` và visible range 42 ngày:

| Cách xử lý | Median | Plan-day references |
| --- | ---: | ---: |
| Legacy materialization, giới hạn 730 ngày từ start | 253,27 ms | 730.000 |
| Visible-range materialization | 6,80 ms | 18.000 |

Speedup quan sát trong lần benchmark xác minh cuối là khoảng 37,23 lần. Số reference của visible-range chỉ có 18.000 thay vì 42.000 vì open plan chỉ hiển thị đến `today`, không hiển thị các ngày tương lai còn lại trong grid. Thời gian có thể dao động giữa các lần chạy; reference count và concurrency peak là các chỉ số xác định.

Đây là micro-benchmark của thuật toán materialization, không phải cam kết latency của toàn Obsidian UI. Cần tiếp tục manual/profile trên vault thực để đo I/O, React commit và peak heap.

Initial read hiện dùng `mapWithConcurrency()` với giới hạn cố định 8. Test xác nhận observed peak concurrency bằng 8 và output order được giữ nguyên. Mức 8 được chọn làm mặc định chung desktop/mobile để ưu tiên peak memory ổn định; chỉ nên tách cấu hình theo platform khi profiling thực tế chứng minh có lợi.

## 16. Logging và quan sát hiệu năng

Không để performance logging bật mặc định trong release. Trong development có thể dùng cờ module-level hoặc esbuild define:

```ts
const PERF_DEBUG = false;
```

Các span hữu ích:

```ts
performance.mark('trader-journal:index:start');
// build
performance.mark('trader-journal:index:end');
performance.measure(
	'trader-journal:index',
	'trader-journal:index:start',
	'trader-journal:index:end',
);
```

Chỉ log số lượng và thời gian. Không log nội dung vault, tên file cá nhân hoặc dữ liệu trade trong telemetry. Plugin không nên gửi các số liệu này ra ngoài.

## 17. Rủi ro khi refactor

### 17.1. Metadata cache chưa sẵn sàng

File vừa tạo có thể chưa có frontmatter trong metadata cache. Không dùng metadata cache làm nguồn duy nhất để phân loại create event.

### 17.2. Settings root lồng nhau

Người dùng có thể cấu hình plan/setup folder nằm trong journal root hoặc ngược lại. Path classifier phải kiểm tra root cụ thể trước và có test cho cấu hình lồng nhau.

### 17.3. Rename folder

Obsidian có thể phát event trên folder thay vì từng child tùy thao tác. Khi folder được rename/delete, cần xóa mọi entry có prefix path cũ, không chỉ entry trùng chính xác path folder.

API cần hỗ trợ:

```ts
removePathPrefix(oldFolderPath: string): boolean;
```

### 17.4. Snapshot consistency

Trade, plan và setup indexes có thể cập nhật ở thời điểm khác nhau. Nếu UI cần snapshot nguyên tử, repository nên batch thay đổi và notify sau khi các index liên quan hoàn tất.

### 17.5. Thay đổi ngày lúc nửa đêm

Open plan phụ thuộc “hôm nay”. Range selector phải refresh khi qua nửa đêm như calendar hiện tại, kể cả không có vault event.

### 17.6. Mobile memory

Concurrency thấp hơn và range-based plan data đặc biệt quan trọng trên mobile. Không giữ toàn bộ raw file contents trong index; chỉ giữ parsed fields cần cho UI/lookup.

## 18. Danh sách file dự kiến thay đổi

### Giai đoạn 1

```text
src/journal/pathScope.ts               # mới
src/journal/JournalDataService.ts
src/trades/journalIndex.ts
src/plans/planIndex.ts
src/trades/storage.ts
src/trades/autoRebuild.ts
src/settings.ts                        # nếu bổ sung helper normalize root
src/ui/SettingsTab.tsx
```

### Giai đoạn 2

```text
src/journal/TraderJournalRepository.ts # mới, nếu tách service
src/setups/setupIndex.ts                # mới
src/setups/storage.ts
src/plans/storage.ts
src/trades/storage.ts
src/ui/TraderJournalModal.tsx
src/ui/TradePlanModal.tsx
src/dashboard/SetupOverview.tsx
src/utils/async.ts                      # mới
```

### Giai đoạn 3–4

```text
src/plans/planIndex.ts
src/ui/TradeCalendarView.tsx
src/graph/tagSync.ts
src/main.ts
src/settings.ts hoặc plugin data types
```

Tên file cuối cùng có thể thay đổi theo quyết định refactor, nhưng trách nhiệm module nên được giữ rõ ràng.

## 19. Checklist triển khai

### Trước khi sửa

- [ ] Tạo benchmark baseline.
- [ ] Ghi lại số read/notify hiện tại cho unrelated modify.
- [ ] Thêm tests bảo vệ hành vi hiện tại của calendar và stats.
- [ ] Xác nhận quy tắc cho folder rename/delete.

### Quick wins

- [ ] Thêm path classifier dùng chung.
- [ ] Lọc toàn bộ vault events.
- [ ] Loại plan/setup/attachments khỏi journal scope.
- [ ] Không rebuild snapshot khi map không đổi.
- [ ] Không notify khi dữ liệu không đổi.
- [ ] Commit settings folder trên blur/debounce.

### Index/repository

- [ ] Thêm plan lookup theo ID.
- [ ] Thêm setup lookup theo ID.
- [ ] Loại scan lặp trong graph link resolution.
- [ ] Giới hạn concurrency initial reads.
- [ ] Queue stats rebuild theo path.

### Calendar

- [ ] Thêm plan range query.
- [ ] Chỉ materialize visible month.
- [ ] Test open/closed/cancelled plan.
- [ ] Test qua midnight và timezone.

### Startup/migration

- [ ] Loại `getMarkdownFiles()` khỏi Graph tag sync.
- [ ] Traverse scoped roots.
- [ ] Thêm migration version.
- [ ] Batch migration writes.

### Trước release

- [ ] `npm run lint` đạt.
- [ ] `npm run build` đạt.
- [ ] `npm run validate` đạt.
- [ ] Manual test desktop đạt.
- [ ] Manual test mobile nếu có điều kiện.
- [ ] So sánh benchmark trước/sau.
- [ ] Kiểm tra không có listener/timer leak.

## 20. Kết luận

Vấn đề hiệu năng lớn nhất không nằm ở React hay kích thước bundle, mà nằm ở phạm vi event và cách snapshot được dựng lại. Chỉ cần sửa đúng event routing và tránh no-op rebuild, plugin sẽ giảm đáng kể background work trong Obsidian.

Thứ tự đầu tư hợp lý:

```text
Event scope
   → no-op detection
   → shared lookup index
   → range-based plan calendar
   → scoped migration/startup
   → bundle micro-optimization
```

Không nên tối ưu bundle hoặc thay framework trước khi hoàn thành bốn bước đầu, vì chúng không xử lý nguyên nhân gây I/O, CPU và React update khi người dùng chỉnh sửa vault.

## 21. Thứ tự triển khai đã chốt

Thứ tự dưới đây thay thế cách gom phase ở mức quá rộng khi triển khai thực tế:

1. Tạo path classifier robust và lọc vault event.
2. Thêm kết quả `changed`, cache snapshot và chỉ notify khi dữ liệu đổi.
3. Xử lý rename/delete folder và pending timer theo path prefix.
4. Thêm test snapshot identity, snapshot build và notify count.
5. Queue/coalesce stats rebuild theo path.
6. Tạo canonical plan/setup lookup index dùng chung.
7. Chuyển plan calendar sang query theo visible range và loại lỗi giới hạn 730 ngày.
8. Chuyển folder settings sang commit/debounce có flush khi unmount.
9. Chuyển Graph tag sync thành scoped, versioned migration.
10. Đo benchmark trước/sau rồi mới chốt concurrency limit.

Mỗi thứ tự phải hoàn tất lint, type-check và các test liên quan trước khi chuyển sang thứ tự tiếp theo. Nếu một thay đổi làm public snapshot hoặc hành vi UI đổi, cần hoàn tất consumer migration trong cùng thứ tự để repository luôn ở trạng thái build được.

## 22. Trạng thái triển khai

Hoàn tất ngày 2026-08-13:

- [x] Path classifier chọn root khớp cụ thể nhất và lọc event ngoài scope.
- [x] Cached snapshot, semantic fingerprint, `changed` result và conditional notify.
- [x] Rename/delete folder cùng pending timer được xử lý theo prefix.
- [x] Regression tests cho path scope, snapshot identity và notify count.
- [x] Auto stats rebuild được serialize/coalesce theo path.
- [x] Canonical plan/setup reference index và lookup theo ID.
- [x] Calendar materialize plan theo visible range; loại giới hạn 730 ngày.
- [x] Folder settings commit/debounce và flush khi blur, Enter hoặc unmount.
- [x] Scoped, versioned Graph tag migration và incremental sync.
- [x] Synthetic benchmark và concurrency limit 8 cho initial reads.

Các lệnh kiểm tra chuẩn sau triển khai:

```bash
npm test
npm run lint
npm run build
npm run validate
npm run benchmark
```
