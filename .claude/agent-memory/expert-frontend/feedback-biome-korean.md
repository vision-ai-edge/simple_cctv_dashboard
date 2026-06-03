---
name: Biome Korean Comment Bug in Svelte Files
description: Biome이 .svelte 파일 script 블록의 한국어 주석을 파싱할 때 멀티바이트 경계 버그 발생
type: feedback
---

# Biome 한국어 주석 버그

**Rule:** .svelte 파일의 `<script>` 블록 내 주석은 영어로 작성한다.

**Why:** Biome 1.9.x는 .svelte 파일의 한국어(멀티바이트) 주석을 처리할 때 byte boundary 오류로 크래시가 발생한다. 이 오류는 Biome 버그(crates/biome_diagnostics/src/display/frame.rs:229)로 추적된 상태.

**How to apply:** .svelte 파일 `<script lang="ts">` 블록 내부 주석은 반드시 영어로 작성. 템플릿(`<template>`, `{#if}` 등) 내부 텍스트는 한국어 사용 가능.
