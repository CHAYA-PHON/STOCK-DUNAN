# Project Rules and Guidelines

## Versioning System
The version format must always be maintained using semantic versioning: **v[Major].[Minor].[Patch] Stable Release**
Format definition:
- **Major (V.x.y.z)**: รอบปีที่ปรับปรุง (เช่น ปี 2026 ใช้ 26 หรือ 2026)
- **Minor (Vx.y.z)**: Addition of a new subsystem, new tab, or new major feature module.
- **Patch (Vx.y.z)**: Bug fixes, UI/styling improvements, layout optimizations, and minor changes.

**Rule**: Every time an update or modification is made, increment the version accordingly.
- Current Baseline: `v26.5.0`
- Current Version after recent fixes (Implemented Network-First SW caching strategy to prevent stale 404 bundle assets): `v26.5.3`
- Current Version after adding AI System (Implemented WSM-DUNAN AI Inventory Analytics subsystem with secure backend Express proxy to Gemini API): `v26.6.0`
- Current Version after adding AI Stock Discrepancy Predictor (Implemented AI Stock Discrepancy Prediction subsystem for analyzing forgotten stock-out and excess stock with physical-history auditing): `v26.7.0`
- Current Version after adding Location Relocation System (Implemented WSM-DUNAN physical location transfer log system with no effect on global product stock quantities): `v26.8.0`
- Current Version after adding Real-time Location Stock Inspector (Implemented dual-tab layout in Location Relocation tab allowing users to inspect stock models, count, and quantities per location in real-time): `v26.8.1`
- Current Version after adding Dedicated Location Work Inspector (Implemented a primary sidebar tab "ตรวจสอบ Location" featuring visual layout cards, summary metrics, and a background data reconciliation service for automatic mapping of unallocated product stocks): `v26.9.0`
- Current Version after fixing Stock-In/Out Sync Issue (Aligned and corrected getSafeProductId mismatch in syncQueue.ts to ensure stock transactions update the master product database successfully): `v26.9.1`
- Current Version after implementing self-healing reconciliation (Implemented dynamic background reconciliation on app startup to automatically audit and restore missing master stock quantities from previous mismatched transactions): `v26.9.2`
- Current Version after integrating Google Sheets database synchronization (Implemented full Google Sheets sync subsystem, OAuth scope bindings, spreadsheet mapping, manual bulk export/import for products, and background real-time transaction auto-syncing): `v26.10.0`
- Current Version after centralizing Google Sheets Database (Configured Google Sheets URL/ID as a central database stored globally in Firestore settings, enabling real-time sheet URL propagation to all users and read-only locks for non-admin roles): `v26.11.0`
- Current Version after restricting attendance to store keepers (Filtered the shift scheduling, monthly summaries, and daily logs inside the check-in and shift system to display only user_store employees): `v26.11.1`
- Current Version after adding reboot shortcut button (Configured sidebar refresh action to instantly reboot and reload the program page via window.location.reload): `v26.11.2`
- Current Version after adding Searchable Locations & Negative Stock Prevention (Implemented fully searchable combobox dropdowns for source and destination locations in relocation system, paired with real-time stock-out warnings and validation to block negative physical location stocks): `v26.12.0`
- Current Version after fixing Sync Queue Duplicate Label notifications, Auto-populating stock-out quantity from matching stock-in labels, Deferring Full Box confirmations, appending Employee IDs to auto-labels, and clearing Label input upon adding to cart: `v26.13.0`
- Current Version after fixing Offline/Sandbox Session Auto-logout issue (Bypassed online checks when Sandbox is active and protected local session from deletions on Firestore cache misses or Quota Exceeded errors): `v26.13.1`
- Current Version after adding Direct Google Sheets Sync Fallback (Decoupled sync queue from Firestore success, added fallback to local Firestore IndexedDB cache for Google Sheets manual exports, and added a Google Sheets bypass button allowing direct transaction uploads when Firestore quota is exceeded or offline): `v26.14.0`


