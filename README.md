# Trader Journal

Trader Journal is a local-first Obsidian plugin for planning trades, recording live and backtest executions, and reviewing performance without moving trading data outside the vault.

The plugin organizes the workflow around three connected records:

```text
Setup → Plan → Live trade
   └────────→ Backtest trade
```

- A **setup** is a reusable trading definition stored as a normal Markdown note.
- A **plan** applies a setup to a symbol, date range, bias, and current market context.
- A **trade** records an actual live or backtest execution.

Trader Journal adds Obsidian wikilinks and tags to these notes, so their relationships can also be explored in Graph view.

## Features

### Trade setups

- Create reusable setup notes with an automatically generated stable ID.
- Define the setup name, status, applicable symbols, and timeframes in a modal.
- Complete the detailed definition manually in Markdown.
- Choose existing setups when creating plans, live trades, or backtest trades.
- Archive setups without removing them from historical records.
- View active and archived setups from the dashboard.

### Trade plans

- Create live trade plans for a symbol and date range.
- Track plan status, directional bias, setup, timeframes, entry criteria, invalidation, take-profit plan, risk notes, images, and general notes.
- Populate plan fields from the selected setup definition.
- Keep a snapshot of the applied setup so later setup edits do not silently rewrite historical plans.
- Link live trades back to their originating plan.

### Live and backtest journals

- Record live and backtest trades through dedicated modal flows.
- Store one daily journal note per symbol.
- Select setups from the setup library instead of entering inconsistent free text.
- Automatically use and lock the plan setup when a live trade is linked to a plan.
- Track side, timeframe, result, RR, prices, images, notes, timestamps, and holding time.
- Calculate live-trade RR from entry, stop-loss, take-profit, or exit prices.
- Derive live trade status from the closing timestamp.
- Review closed live trades by context, entry timing, plan adherence, mistakes, lessons, and the next action.
- Regenerate daily summaries and statistics from the stored trade blocks.

### Dashboard and calendar

- Review performance metrics, attention indicators, and recent trades in the dashboard.
- Track closed trades awaiting review, common mistakes, and RR grouped by plan adherence.
- View reusable setups in the right dashboard column above the plan overview.
- Review active plans, plan execution rate, and plans without linked trades.
- Open setup, plan, and trade notes directly from dashboard cards.
- Browse trades and plans in a month or horizontal sidebar calendar.
- Optionally display weekly economic events filtered by country/currency, impact, and time zone.

### Images and local data

- Paste image files directly into trade and plan modals.
- Store pasted images inside the vault.
- Move unsaved pasted images to trash when a modal closes without saving.
- Optionally open rendered images in a full-screen preview.
- Keep external image previews disabled by default.

## Recommended workflow

1. Run **Trader Journal: Add trade setup**.
2. Enter the setup name, status, and timeframes.
3. Complete the generated setup note in Markdown.
4. Run **Trader Journal: Add trade plan** and select the setup.
5. Adjust the setup snapshot for the current market context and save the plan.
6. Add a live trade and select the plan, or add a backtest trade and select the setup directly.
7. Review the results in **Trader Journal: Open trading dashboard**, the trade calendar, or Obsidian Graph view.

## Commands

Open the Obsidian Command palette and search for `Trader Journal`.

| Command | Command ID | Description |
| --- | --- | --- |
| **Add backtest trade** | `add-backtest-trade` | Opens the backtest trade modal. |
| **Add live trade** | `add-live-trade` | Opens the live trade modal. |
| **Add trade plan** | `add-trade-plan` | Creates a plan from an existing setup or opens the setup creation flow when needed. |
| **Add trade setup** | `add-trade-setup` | Creates the basic setup note and opens it for manual Markdown editing. |
| **Open trading dashboard** | `open-dashboard` | Opens the dashboard in a workspace tab. |
| **Open trade calendar** | `open-trade-calendar` | Opens the trade calendar sidebar. |
| **Recalculate current stats** | `recalculate-current-journal-stats` | Rebuilds summary statistics and Graph metadata for the active journal note. |

Command IDs are stable and can be used when assigning Obsidian hotkeys.

## Setup notes

The default setup folder is `Trading/_setups`. The plugin creates a note with basic frontmatter and empty detail sections:

```yaml
---
traderJournalNoteType: trader-journal-setup
tags:
  - trader-journal-setup
setupId: setup-opening-range-breakout
name: Opening range breakout
status: active
symbols:
  - NQ
  - ES
timeframes:
  - 1m
  - 5m
updatedAt: 2026-08-13T10:30:00+07:00
---
```

```markdown
# Opening range breakout

## Description

## Entry criteria

## Invalidation

## Take profit

## Risk rules
```

The setup note is the source of truth. Complete the sections manually using normal Markdown. Keep the generated `setupId` stable because plans and trades use it for internal relationships.

The optional `symbols` list controls where the setup appears. A setup with `symbols: [NQ, ES]` is offered only after selecting NQ or ES in plan, live-trade, and backtest modals. Omitting `symbols` or using an empty list makes the setup available for every symbol.

The section headings are structural. Keep their spelling unchanged so the plugin can read their contents when applying a setup to a plan.

## Plans and setup snapshots

Selecting a setup in the plan modal copies these values into the plan:

- Setup name and ID.
- Timeframes.
- **Entry criteria** → entry plan.
- **Invalidation** → invalidation.
- **Take profit** → take-profit plan.
- **Risk rules** → risk notes.

The copied values remain editable in the plan. A plan stores both `setup_id` and a snapshot of the applied content. Editing the setup note later affects newly created plans but does not automatically alter previously saved plans.

Plans are stored under the configured plan folder using this layout:

```text
Trading/Live/_plans/{symbol}/{year}/{month}/{date}-{symbol}-{title}.md
```

## Journal storage

Daily journals are stored under their configured backtest or live root:

```text
Trading/
  _setups/
    opening-range-breakout.md
  Backtests/
    NQ/
      2026/
        08/
          2026-08-13.md
    _attachments/
  Live/
    _plans/
      NQ/
        2026/
          08/
            2026-08-13-NQ.md
    NQ/
      2026/
        08/
          2026-08-13.md
    _attachments/
```

The daily journal path format is:

```text
{journalFolder}/{symbol}/{year}/{month}/{date}.md
```

The daily file date comes from the date portion of `opened_at` and is treated as the actual trade date throughout the dashboard and calendar.

## Trade blocks

Trades are stored in fenced JSON blocks. The JSON block is the source of truth for a trade.

````markdown
```trader-journal-trade
{
	"schemaVersion": 1,
	"id": "20260813093000-NQ-a1b2c3",
	"date": "2026-08-13T09:30:00+07:00",
	"journal_type": "backtest",
	"setup_id": "setup-opening-range-breakout",
	"symbol": "NQ",
	"side": "long",
	"setup": "Opening range breakout",
	"timeframe": "1m",
	"result": "win",
	"rr": 2,
	"tags": ["trend"],
	"images": [],
	"notes": "Followed the setup.",
	"opened_at": "2026-08-13T09:30:00+07:00",
	"closed_at": "2026-08-13T09:45:00+07:00",
	"holding_time": 15
}
```
````

The generated summary table and frontmatter statistics are rebuilt from these blocks. Invalid JSON blocks are rendered as errors and counted in `invalidTradeBlockCount` instead of being silently excluded.

### Post-trade reviews

Closed live trades can store an optional review inside the same trade block. Keeping the review with the trade preserves a single source of truth and lets the dashboard aggregate process mistakes independently of win/loss results.

```json
"review": {
  "schema_version": 1,
  "context": "wrong",
  "entry_timing": "early",
  "plan_adherence": "not_followed",
  "mistake_tags": ["wrong_context", "early_entry", "no_confirmation"],
  "what_went_well": "Kept the planned risk and did not move the stop.",
  "lesson": "The higher-timeframe context was not confirmed.",
  "next_action": "Wait for the 5m candle to close before entering.",
  "reviewed_at": "2026-08-14T20:30:00+07:00"
}
```

Review is optional while closing a trade. A closed trade without a review appears in the dashboard attention area and can be reviewed later from the trade card, dashboard, or calendar.

Backtest daily note properties also include `backtest_start_date` and `backtest_end_date`, which can be completed manually to record the tested data range.

## Live trade calculations

While a live trade is open, RR uses `take_profit` as the target. Once the trade is closed, it uses `exit_price`.

```text
Long:  (target - entry) / (entry - stop loss)
Short: (entry - target) / (stop loss - entry)
```

Closed trade results are derived from RR:

- Positive RR → win.
- Negative RR → loss.
- Zero RR → breakeven.

A blank `closed_at` means the live trade is open. Open live trades are included in total trade counts but excluded from outcome statistics until closed.

## Graph view

Trader Journal writes real Obsidian wikilinks into frontmatter so Graph view can display setup, plan, and journal relationships:

```text
Setup ↔ Plan ↔ Live journal
Setup ↔ Backtest journal
```

Examples:

```yaml
# Plan note
setupLink: "[[Trading/_setups/opening-range-breakout]]"

# Live or backtest daily note
setupLinks:
  - "[[Trading/_setups/opening-range-breakout]]"

# Live daily note
planLinks:
  - "[[Trading/Live/_plans/NQ/2026/08/2026-08-13-NQ]]"
```

The plugin also adds a tag matching each generated note type:

| Note type | Graph tag |
| --- | --- |
| Setup | `#trader-journal-setup` |
| Plan | `#trader-journal-live-plan` |
| Live daily journal | `#trader-journal-live-symbol-day` |
| Backtest daily journal | `#trader-journal-symbol-day` |

Use Graph view filters such as:

```text
tag:#trader-journal-setup
tag:#trader-journal-live-plan
tag:#trader-journal-live-symbol-day
tag:#trader-journal-symbol-day
```

Generated notes use the `traderJournalNoteType` property to avoid conflicts with a vault-wide `type` property.
Existing plugin notes using the legacy `type` property, or missing their note-type tag, are migrated after the
workspace is ready. User-created tags are preserved.

## Settings

Open **Settings → Trader Journal**.

| Setting | Description |
| --- | --- |
| **Language** | Selects English or Vietnamese for the plugin interface. |
| **Backtest journal folder** | Root folder for generated backtest daily notes. |
| **Live journal folder** | Root folder for generated live daily notes. |
| **Trade plan folder** | Root folder for live trade plan notes. |
| **Trade setup folder** | Root folder for reusable setup notes. |
| **Symbols** | Symbols available in trade and plan modals. |
| **Timeframes** | Timeframes available in trade and setup modals. |
| **Calendar display** | Selects the month grid or horizontal calendar. |
| **Remote images** | Allows previews from external image URLs. Disabled by default. |
| **Image preview modal** | Controls full-screen preview when selecting rendered images. |
| **Economic calendar** | Enables weekly economic-event requests. Disabled by default. |
| **Economic calendar time zone** | Controls event grouping and displayed times. |
| **Countries and currencies** | Filters events by codes such as `USD`, `EUR`, or `GBP`. |
| **News impact** | Filters `High`, `Medium`, `Low`, and `Holiday` events. |

## Installation

### Manual installation

1. Create `.obsidian/plugins/trader-journal/` inside the vault.
2. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
3. Reload Obsidian.
4. Open **Settings → Community plugins** and enable **Trader Journal**.

The plugin requires Obsidian `1.6.6` or newer and is not desktop-only.

## Privacy and network access

Trader Journal works locally by default and does not collect analytics or telemetry. Journal content, filenames, setup definitions, plans, and images are not transmitted by the plugin.

Pasted images are stored inside the vault. Temporary pasted images are moved to trash when their modal closes without saving.

Remote image previews are disabled by default. Enabling **Remote images** allows requests to image hosts referenced by the user.

The economic calendar is also disabled by default. When enabled, the plugin requests:

```text
https://nfs.faireconomy.media/ff_calendar_thisweek.json
```

The request does not include vault content, filenames, account information, or telemetry. Successful responses are cached in the plugin's `data.json` for the source week. Failed requests use a persisted five-minute cooldown before another attempt.

## Development

Requirements:

- Current Node.js LTS, Node 18 or newer.
- npm.

Install dependencies:

```bash
npm install
```

Run the development watcher:

```bash
npm run dev
```

Create and validate a production bundle:

```bash
npm run build
```

Run ESLint:

```bash
npm run lint
```

Validate the manifest:

```bash
npm run validate
```

Source code lives in `src/`. The entry point is `src/main.ts`, and esbuild produces the bundled `main.js` at the plugin root.

## Release artifacts

Attach these individual files to an Obsidian plugin release:

- `manifest.json`
- `main.js`
- `styles.css`

The release tag must exactly match the version in `manifest.json` without a leading `v`. The plugin ID is `trader-journal` and must remain stable.
