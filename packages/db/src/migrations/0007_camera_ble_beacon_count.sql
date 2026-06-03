-- 0007_camera_ble_beacon_count.sql
-- 카메라 주변 BLE 비컨 신호 개수를 지도/API에 노출하기 위한 컬럼.

ALTER TABLE cameras ADD COLUMN ble_beacon_count INTEGER NOT NULL DEFAULT 0;
