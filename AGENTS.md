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

