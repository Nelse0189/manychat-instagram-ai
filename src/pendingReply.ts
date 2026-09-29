import type { PackId } from "./catalog.js";
import type { OutboundMedia, PendingReply } from "./types.js";

export type PendingPatch = {
  subscriberId: string;
  dueAt: string;
  now: string;
  media: OutboundMedia[];
  filesReady: boolean;
  filesFailed: boolean;
  sawPaymentScreenshot: boolean;
  quoted: boolean;
  claimed: boolean;
  releasedPackId: PackId | null;
  releasedPackName: string | null;
};

export function mergeMedia(current: OutboundMedia[], extra: OutboundMedia[]): OutboundMedia[] {
  const seen = new Set(current.map((item) => item.url));
  const next = [...current];
  for (const item of extra) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    next.push(item);
  }
  return next.slice(0, 9);
}

/** Keep the original due time. Later messages only add text and media. */
export function mergePendingReply(current: PendingReply | null, input: PendingPatch): PendingReply {
  if (!current) {
    const filesReady = input.filesReady;
    return {
      subscriberId: input.subscriberId,
      dueAt: input.dueAt,
      taskName: null,
      media: input.media.slice(0, 9),
      filesReady,
      filesFailed: input.filesFailed && !filesReady,
      sawPaymentScreenshot: input.sawPaymentScreenshot,
      quoted: input.quoted,
      claimed: input.claimed,
      releasedPackId: input.releasedPackId,
      releasedPackName: input.releasedPackName,
      createdAt: input.now,
      updatedAt: input.now,
    };
  }
  const filesReady = current.filesReady || input.filesReady;
  return {
    ...current,
    media: mergeMedia(current.media, input.media),
    filesReady,
    filesFailed: (current.filesFailed || input.filesFailed) && !filesReady,
    sawPaymentScreenshot: current.sawPaymentScreenshot || input.sawPaymentScreenshot,
    quoted: current.quoted || input.quoted,
    claimed: current.claimed || input.claimed,
    releasedPackId: input.releasedPackId ?? current.releasedPackId,
    releasedPackName: input.releasedPackName ?? current.releasedPackName,
    updatedAt: input.now,
  };
}
