# Trader Journal

Trader Journal is an Obsidian plugin for recording backtest and live trades in Markdown notes. It stores one daily journal file per symbol and renders each trade JSON block as a readable card in Reading View.

## Features

- Add backtest trades from an Obsidian modal.
- Add live trades from a separate modal flow.
- Open a sidebar calendar with filter-specific trade, plan, and economic-event indicators.
- Show this week's economic events alongside trades, filtered by country/currency and impact.
- Edit live trades from the sidebar calendar or rendered Markdown cards.
- Store one file per symbol per day.
- Configure journal folder, symbols, and timeframes in settings.
- Track side, setup, timeframe, result, RR, tags, images, notes, opened time, closed time, and holding time.
- Track live entry price, stop loss, take profit, open/closed status, exit price, and auto-calculated RR.
- Auto-calculate holding time from opened and closed timestamps.
- Paste image files directly into the Images input; unsaved pasted images are moved to trash if the modal closes without saving.
- Render trade JSON blocks as cards in Reading View.
- Optionally select a rendered image to open a full-screen image preview.
- Recalculate daily statistics automatically when a journal note changes.
- Recalculate the active note manually with the command **Recalculate current stats**.

## Storage Layout

Journal files are created under the configured backtest or live journal folder. The daily file date is the day you record the journal entry, not necessarily the trade execution date inside the trade data.

```text
Trading/Backtests/
  BTC/
    2026/
      06/
        2026-06-15.md
  _attachments/
Trading/Live/
  BTC/
    2026/
      06/
        2026-06-15.md
  _attachments/
```

The path format is:

```text
{journalFolder}/{symbol}/{year}/{month}/{date}.md
```

Example:

```text
Trading/Backtests/BTC/2026/06/2026-06-15.md
Trading/Live/BTC/2026/06/2026-06-15.md
```

## Trade Blocks

Trades are stored as fenced JSON code blocks:

````markdown
```trader-journal-trade
{
	"schemaVersion": 1,
	"id": "20260412234400-BTC-a1b2c3",
	"date": "2026-06-15T10:06:00+07:00",
	"journal_type": "backtest",
	"symbol": "BTC",
	"side": "long",
	"setup": "Breakout",
	"timeframe": "1m",
	"result": "win",
	"rr": 1,
	"tags": ["trend"],
	"images": [
		{
			"type": "file",
			"value": "Trading/Backtests/_attachments/BTC-20260615-102030-a1b2c3.png"
		}
	],
	"notes": "Followed the plan.",
	"opened_at": "2026-06-15T09:30:00+07:00",
	"closed_at": "2026-06-15T10:05:00+07:00",
	"holding_time": 35
}
```
````

The JSON block is the source of truth. The `date` field stores when the trade entry was created and is used to sort items inside a calendar day. The summary table and frontmatter statistics are regenerated from the trade blocks. Invalid trade JSON blocks are rendered as errors and counted in `invalidTradeBlockCount` so they are not silently hidden from the daily stats.

Live trade RR is calculated automatically from actual risk. While a trade is open, the calculation uses `take_profit` as the target price. Once the trade is closed, it uses `exit_price` instead. For long trades the formula is `(target_price - entry_price) / (entry_price - stop_loss)`. For short trades it is `(entry_price - target_price) / (stop_loss - entry_price)`. Closed live trade results are derived from the calculated RR: positive is a win, negative is a loss, and zero is breakeven.

Live trade status is derived from `closed_at`: a blank value means `open`, while setting a closing time makes the trade `closed`.

Backtest daily note properties include `backtest_start_date` and `backtest_end_date` with empty values so users can manually record the date range of the backtested data.

## Commands

- **Add backtest trade**: Opens the trade entry modal.
- **Add live trade**: Opens the live trade entry modal.
- **Open trade calendar**: Opens the sidebar calendar view.
- **Recalculate current stats**: Rebuilds the summary and frontmatter statistics for the active journal note.

## Settings

- **Backtest journal folder**: Root folder for generated backtest journal files.
- **Live journal folder**: Root folder for generated live journal files.
- **Economic event filters**: Optionally show every event returned for the source week without time, country/currency, or impact filters.
- **Symbols**: Symbols shown in the trade modal.
- **Timeframes**: Timeframes shown in the trade modal.
- **Calendar display**: Chooses the month grid or horizontal calendar layout in the sidebar.
- **Remote images**: Allows image previews from external URLs. This is disabled by default.
- **Image preview modal**: Controls whether selecting an image in a rendered trade or plan block opens the large preview.
- **Economic calendar**: Enables loading this week's events from Faireconomy. This is disabled by default.
- **Economic calendar time zone**: Controls how economic event dates and times are displayed. Defaults to `Asia/Ho_Chi_Minh`.
- **Countries and currencies**: Only matching event codes such as `USD`, `EUR`, or `GBP` are shown.
- **News impact**: Chooses which `High`, `Medium`, `Low`, and `Holiday` events are shown.

## Privacy

Trader Journal works locally by default and does not collect analytics or telemetry. Pasted images are saved inside the vault under `_attachments`; if you close the trade modal without saving, temporary pasted images are moved to trash.

Remote image previews are disabled by default. If you enable **Remote images**, opening notes with external image URLs may send requests to those image hosts.

The economic calendar is disabled by default. If you enable it, the plugin requests
`https://nfs.faireconomy.media/ff_calendar_thisweek.json`. The request does not include vault content,
filenames, account information, or telemetry. A successful response is stored in the plugin's `data.json`
for the source calendar week. The plugin only requests the endpoint when there is no cached response for
the current source week; changing filters or the display time zone does not trigger another request. Failed
requests are subject to a persisted five-minute cooldown before another attempt can be made.

## Development

Install dependencies:

```bash
npm install
```

Run development build in watch mode:

```bash
npm run dev
```

Run production build:

```bash
npm run build
```

Run lint:

```bash
npm run lint
```

## Release Artifacts

For an Obsidian plugin release, attach these files:

- `manifest.json`
- `main.js`
- `styles.css`

The plugin ID is `trader-journal`. For local installation, place the release files in `.obsidian/plugins/trader-journal/`.
