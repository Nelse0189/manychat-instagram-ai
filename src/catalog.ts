export const PACKS = [
  {
    id: "photo_1",
    name: "One photo",
    kind: "photo",
    count: 1,
    priceUsd: 15,
    description: "One photo from the collection.",
  },
  {
    id: "photo_3",
    name: "Three photos",
    kind: "photo",
    count: 3,
    priceUsd: 40,
    description: "Three photos from the collection.",
  },
  {
    id: "photo_5",
    name: "Five photos",
    kind: "photo",
    count: 5,
    priceUsd: 60,
    description: "Five photos from the collection.",
  },
  {
    id: "video_1",
    name: "One video",
    kind: "video",
    count: 1,
    priceUsd: 25,
    description: "One video from the collection.",
  },
  {
    id: "video_3",
    name: "Three videos",
    kind: "video",
    count: 3,
    priceUsd: 60,
    description: "Three videos from the collection.",
  },
  {
    id: "video_5",
    name: "Five videos",
    kind: "video",
    count: 5,
    priceUsd: 90,
    description: "Five videos from the collection.",
  },
] as const;

export type PackId = (typeof PACKS)[number]["id"];
export type Pack = (typeof PACKS)[number];

export function packById(id: string | null | undefined): Pack | undefined {
  return PACKS.find((pack) => pack.id === id);
}

export function catalogSummary(): string {
  return PACKS.map((pack) => `${pack.name}: $${pack.priceUsd} USD`).join("; ");
}
