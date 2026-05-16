/**
 * EdgeAI Box REST API v1.3.6 Zod 스키마.
 *
 * OpenAPI 3.0.3 명세(`/tmp/edgeai_box_openapi.json`)를 기준으로 작성되었으며,
 * 모든 응답은 `BoxClient`의 #fetch 단계에서 `safeParse`로 검증된다.
 *
 * 스키마는 정확성보다 *유연성*을 우선한다: 알 수 없는 필드는 통과시키며,
 * 필수 필드 검증 실패 시에만 BoxApiError 를 던진다.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 공통 응답 봉투
// ---------------------------------------------------------------------------

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  timestamp: z.number(),
});

export const SimpleResponseSchema = z
  .object({
    success: z.boolean().optional(),
    timestamp: z.number().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const PaginationInfoSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type PaginationInfo = z.infer<typeof PaginationInfoSchema>;

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const LoginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.null(),
});

export const UserInfoResponseSchema = z.object({
  username: z.string(),
  hasApiKey: z.boolean(),
});

export const ApiKeyResponseSchema = z.object({
  apiKey: z.string(),
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;
export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;

// ---------------------------------------------------------------------------
// system
// ---------------------------------------------------------------------------

export const SystemHealthResponseSchema = z
  .object({
    status: z.string(),
  })
  .passthrough();

export const SystemInfoResponseSchema = z.record(z.unknown());

export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;
export type SystemInfoResponse = z.infer<typeof SystemInfoResponseSchema>;

// ---------------------------------------------------------------------------
// channels
// ---------------------------------------------------------------------------

export const ChannelStatusEnum = z.enum([
  'STOPPED',
  'CONNECTING',
  'RUNNING',
  'PAUSED',
  'ERROR',
  'RETRYING',
]);

export type ChannelStatus = z.infer<typeof ChannelStatusEnum>;

export const ChannelInputTypeEnum = z.enum(['rtsp', 'file', 'usb', 'csi']);

export const ChannelResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    isEnabled: z.boolean().optional(),
    autoStart: z.boolean().optional(),
    status: ChannelStatusEnum.optional(),
    config: z.record(z.unknown()).optional(),
    state: z.record(z.unknown()).optional(),
    outputs: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const ChannelStatusResponseSchema = z
  .object({
    channelId: z.string(),
    status: ChannelStatusEnum,
    isActive: z.boolean().optional(),
    lastErrorMessage: z.string().nullable().optional(),
  })
  .passthrough();

// OpenAPI v1.3.6: `/channels` GET → `{ success, timestamp, summary, channels: [...] }`.
// 호출자(BoxClient.channels.list / channelSyncService)는 array 형태로 다루도록 unwrap.
// array 로 직접 응답하는 변형/테스트 mock 도 그대로 통과시킨다.
export const ChannelListResponseSchema = z.preprocess((val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.channels)) return obj.channels;
  }
  return val;
}, z.array(ChannelResponseSchema));

export const ChannelCreateRequestSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    inputType: ChannelInputTypeEnum,
    rtspUrl: z.string().optional(),
    enableHLS: z.boolean().optional(),
    enableRecording: z.boolean().optional(),
    enableAIProcessing: z.boolean().optional(),
  })
  .passthrough();

export const ChannelUpdateRequestSchema = ChannelCreateRequestSchema.partial();

export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
export type ChannelStatusResponse = z.infer<typeof ChannelStatusResponseSchema>;
export type ChannelCreateRequest = z.infer<typeof ChannelCreateRequestSchema>;
export type ChannelUpdateRequest = z.infer<typeof ChannelUpdateRequestSchema>;
export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>;

// ---------------------------------------------------------------------------
// models / vision-ai
// ---------------------------------------------------------------------------

export const ModelInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    task: z.string().optional(),
    fileSize: z.number().optional(),
    isBuiltIn: z.boolean().optional(),
  })
  .passthrough();

// OpenAPI v1.3.6: `/models` GET → `{ success, timestamp, models: [...] }`.
// ChannelListResponseSchema 와 동일한 패턴으로 envelope unwrap.
// array 로 직접 응답하는 변형/테스트 mock 도 그대로 통과시킨다.
export const ModelListResponseSchema = z.preprocess((val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.models)) return obj.models;
  }
  return val;
}, z.array(ModelInfoSchema));

export const RoiPointSchema = z.tuple([z.number(), z.number()]);

export const RoiRegionSchema = z.object({
  id: z.string(),
  mode: z.enum(['include', 'exclude']),
  points: z.array(z.number()), // flat [x1, y1, x2, y2, ...] 좌표 (정규화 0.0~1.0)
});

export const ModelSlotConfigSchema = z.object({
  modelId: z.string(),
  enabled: z.boolean(),
  frameSkip: z.number().optional(),
  confidenceThreshold: z.number().optional(),
  maxDetections: z.number().optional(),
  detectClasses: z.array(z.string()).optional(),
  roiRegions: z.array(RoiRegionSchema).optional(),
});

export const VisionAIConfigSchema = z
  .object({
    showDetections: z.boolean().optional(),
    showTrackings: z.boolean().optional(),
    showConfidence: z.boolean().optional(),
    showLabels: z.boolean().optional(),
  })
  .passthrough();

export const DetectionsResponseSchema = z
  .object({
    channelId: z.string().optional(),
    detections: z.array(z.record(z.unknown())).optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

export const TrackingsResponseSchema = z
  .object({
    channelId: z.string().optional(),
    trackings: z.array(z.record(z.unknown())).optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type RoiRegion = z.infer<typeof RoiRegionSchema>;
export type ModelSlotConfig = z.infer<typeof ModelSlotConfigSchema>;
export type VisionAIConfig = z.infer<typeof VisionAIConfigSchema>;

// ---------------------------------------------------------------------------
// media (recordings / images / timelapse)
// ---------------------------------------------------------------------------

export const FileInfoSchema = z.object({
  filename: z.string(),
  date: z.string(),
  size: z.number(),
  createdAt: z.number(),
  lastModified: z.number(),
});

export const FilesListResponseSchema = z.object({
  files: z.array(FileInfoSchema),
  pagination: PaginationInfoSchema,
  totalSize: z.number().optional(),
});

export const DateListResponseSchema = z.object({
  dates: z.array(z.string()),
  totalDays: z.number(),
});

export type FileInfo = z.infer<typeof FileInfoSchema>;
export type FilesListResponse = z.infer<typeof FilesListResponseSchema>;
export type DateListResponse = z.infer<typeof DateListResponseSchema>;
