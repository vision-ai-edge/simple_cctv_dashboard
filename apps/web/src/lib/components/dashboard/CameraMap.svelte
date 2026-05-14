<script lang="ts">
/**
 * CameraMap — Leaflet 기반 카메라 위치 지도 컴포넌트.
 *
 * - Leaflet은 SSR 비호환: onMount 내에서 dynamic import 로드 (REQ-DASH-003).
 * - 좌표 보유 카메라 ≥ 1개 → fitBounds 자동 조정 (REQ-DASH-003).
 * - 좌표 0개 → ENV 기본값(서울) 또는 fallback 사용 (D3).
 * - 마커 상태별 색상: online=초록, offline=회색, error=빨강 (REQ-DASH-004).
 * - 팝업: 채널명, Box명, 상태, "상세 보기" 링크 (REQ-DASH-005).
 * - onDestroy: map.remove() 로 메모리 누수 방지 (REQ-DASH-003).
 */

import { onMount, onDestroy } from 'svelte';
import type { CameraWithBox } from '$lib/types/dashboard';
import { getMarkerColor } from '$lib/api/cameras';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** 좌표 보유 카메라 목록 (caller 측에서 필터링하여 전달) */
  cameras: CameraWithBox[];
}

const { cameras }: Props = $props();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mapContainer = $state<HTMLDivElement | null>(null);
// biome-ignore lint/suspicious/noExplicitAny: Leaflet 타입은 동적 import 이후에 확정됨
let mapInstance: any = null;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMount(async () => {
  if (!mapContainer) return;

  // Leaflet은 browser-only — SSR 에서 실행되면 window 오류 발생하므로 dynamic import 필수 (A5)
  const L = (await import('leaflet')).default;

  // 기본 중심점: ENV 변수 > 서울 fallback (D3)
  const defaultLat = Number(import.meta.env.PUBLIC_MAP_DEFAULT_LAT ?? 37.5665);
  const defaultLng = Number(import.meta.env.PUBLIC_MAP_DEFAULT_LNG ?? 126.978);
  const defaultZoom = 10;

  // 지도 초기화
  mapInstance = L.map(mapContainer, { zoomControl: true });

  // OSM 타일 레이어 (REQ-DASH-003 — 무료, API 키 불필요)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(mapInstance);

  // 마커 렌더링 및 뷰포트 설정
  if (cameras.length >= 1) {
    const bounds: [number, number][] = [];

    for (const cam of cameras) {
      if (cam.latitude == null || cam.longitude == null) continue;

      const color = getMarkerColor(cam.status);

      // divIcon: 상태 색상을 반영한 원형 마커 (REQ-DASH-004)
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:16px;height:16px;border-radius:50%;
          background:${color};border:2px solid white;
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
      });

      const marker = L.marker([cam.latitude, cam.longitude], { icon });

      // 팝업 내용 (REQ-DASH-005): 채널명, Box명, 상태, 상세 보기 링크
      const statusLabel = cam.status === 'online' ? '온라인' : cam.status === 'offline' ? '오프라인' : '오류';
      const statusColor = cam.status === 'online' ? '#16a34a' : cam.status === 'error' ? '#dc2626' : '#6b7280';
      const detailUrl = `/boxes/${cam.boxId}`;

      marker.bindPopup(`
        <div style="min-width:160px;font-family:inherit;font-size:13px;line-height:1.5">
          <div style="font-weight:600;margin-bottom:4px">${escapeHtml(cam.name)}</div>
          <div style="color:#64748b;margin-bottom:4px">${escapeHtml(cam.boxName)}</div>
          <div style="margin-bottom:8px">
            <span style="
              display:inline-block;padding:1px 8px;border-radius:9999px;
              font-size:11px;font-weight:500;
              background:${statusColor}1a;color:${statusColor};
            ">${statusLabel}</span>
          </div>
          <a href="${detailUrl}" style="color:#2563eb;text-decoration:underline;font-size:12px">상세 보기</a>
        </div>
      `);

      marker.addTo(mapInstance);
      bounds.push([cam.latitude, cam.longitude]);
    }

    // fit-bounds: 카메라 경계 박스에 맞게 뷰포트 조정 (REQ-DASH-003)
    if (bounds.length > 0) {
      mapInstance.fitBounds(bounds, { padding: [40, 40] });
    }
  } else {
    // 좌표 보유 카메라 없음 → 기본 뷰포트 (서울)
    mapInstance.setView([defaultLat, defaultLng], defaultZoom);
  }
});

onDestroy(() => {
  // 메모리 누수 방지: 컴포넌트 제거 시 Leaflet 인스턴스 해제 (REQ-DASH-003)
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
});

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/** HTML 특수문자 이스케이프 (팝업 XSS 방지) */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
</script>

<!--
  Leaflet CSS — 클라이언트 전용 (SSR 에서는 렌더링되지 않아야 함)
  Note: svelte:head 안의 link 태그는 SSR/CSR 모두에서 삽입되지만,
  실제 Leaflet DOM 조작은 onMount 이후에만 이루어지므로 안전하다.
-->
<svelte:head>
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin=""
  />
</svelte:head>

<!-- 지도 컨테이너 (REQ-DASH-003 — 전체 높이 부모에 의존) -->
<div
  bind:this={mapContainer}
  class="w-full h-full min-h-[400px] rounded-lg overflow-hidden"
  role="application"
  aria-label="카메라 위치 지도"
></div>
