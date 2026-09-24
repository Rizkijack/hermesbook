import type { TownSnapshot, Quest, QuestType } from "@hermesbook/shared";
import { LOCATIONS } from "./locations.js";

type Template = Omit<Quest, "id" | "progress" | "status" | "createdAt" | "expiresAt" | "giver" | "giverName" | "completedAt"> & { giver?: string };

const TEMPLATES: Template[] = [
  {
    title: "Wira-Wiri Pasar",
    description: "Warga butuh keramaian di Market. Kunjungi Market 5 kali — biar dagangan laku.",
    category: "Daily",
    type: "visit",
    targetPlace: "market",
    required: 5,
    difficulty: "easy",
    reward: { text: "+0.15 spirits untuk herd, +5% project", spirits: 0.15, progressBonus: 0.02 },
  },
  {
    title: "Ngobrol Warung",
    description: "Nongkrong di Wet Fleece Tavern 3 kali. Dengar gosip, bagi cerita.",
    category: "Social",
    type: "talk",
    targetPlace: "tavern",
    required: 3,
    difficulty: "easy",
    reward: { text: "+0.2 spirits, hubungan naik", spirits: 0.2 },
  },
  {
    title: "Kurir Kilat Hermes",
    description: "Jelajahi 3 titik kurir: Station, Post Office, dan Market. Hermes butuh jejak cepat.",
    category: "Exploration",
    type: "explore",
    targetPlaces: ["station", "post", "market"],
    required: 3,
    difficulty: "medium",
    reward: { text: "+0.25 spirits, influence faction", spirits: 0.25 },
  },
  {
    title: "Panen Raya",
    description: "Kumpulkan hasil di ladang: MeadowW, MeadowE, Orchard, Trough — 8 kali graze.",
    category: "Work",
    type: "fetch",
    targetPlaces: ["meadowW", "meadowE", "orchard", "trough"],
    required: 8,
    difficulty: "medium",
    reward: { text: "+0.3 spirits, stok pangan aman", spirits: 0.3 },
  },
  {
    title: "Gotong Royong Pagar",
    description: "Bantu proyek 'move the fence ten paces' — kerja 5 kali di lokasi Civic/Work.",
    category: "Work",
    type: "work",
    required: 5,
    difficulty: "medium",
    reward: { text: "+3% progress proyek", progressBonus: 0.03, spirits: 0.1 },
  },
  {
    title: "Jaringan Sosial",
    description: "Bikin 5 obrolan di feed (post/reply). Kota butuh suara.",
    category: "Social",
    type: "social",
    required: 5,
    difficulty: "easy",
    reward: { text: "+0.2 spirits, feed ramai", spirits: 0.2 },
  },
  {
    title: "Penjaga Kolam",
    description: "Jaga kebersihan Pond — kunjungi Pond 4 kali dan minum dengan tertib.",
    category: "Daily",
    type: "visit",
    targetPlace: "pond",
    required: 4,
    difficulty: "easy",
    reward: { text: "+0.15 spirits, air jernih", spirits: 0.15 },
  },
  {
    title: "Keliling Kota",
    description: "Tur 5 lokasi berbeda: Square, Hall, Library, Vault, Dock. Jadi turis lokal.",
    category: "Exploration",
    type: "explore",
    targetPlaces: ["square", "hall", "library", "vault", "dock"],
    required: 5,
    difficulty: "hard",
    reward: { text: "+0.35 spirits, peta terbuka", spirits: 0.35 },
  },
  {
    title: "Ronda Malam",
    description: "Jaga malam di Fire dan Barn 3 kali — cegah gosip liar.",
    category: "Daily",
    type: "visit",
    targetPlaces: ["fire", "barn"],
    required: 3,
    difficulty: "easy",
    reward: { text: "+0.18 spirits", spirits: 0.18 },
  },
  {
    title: "Diplomasi Meja Bundar",
    description: "Ajak 3 warga beda untuk talk/argue. Diplomasi Hermes.",
    category: "Social",
    type: "talk",
    required: 3,
    difficulty: "medium",
    reward: { text: "+0.25 spirits, relasi naik", spirits: 0.25 },
  },
];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

export function generateQuest(world: TownSnapshot, rng: () => number = Math.random): Quest {
  const tpl = pick(TEMPLATES, rng);
  const giver = pick(world.herd, rng);
  const id = "q" + Math.random().toString(36).slice(2, 9);
  const now = Date.now();
  // 24h expiry
  const expiresAt = now + 24 * 60 * 60 * 1000 + Math.floor(rng() * 6 * 60 * 60 * 1000);
  return {
    id,
    title: tpl.title,
    description: tpl.description,
    category: tpl.category,
    type: tpl.type,
    targetPlace: tpl.targetPlace,
    targetPlaces: tpl.targetPlaces ? [...tpl.targetPlaces] : undefined,
    targetAgent: tpl.targetAgent,
    required: tpl.required,
    progress: 0,
    reward: tpl.reward,
    status: "available",
    difficulty: tpl.difficulty,
    giver: giver.id,
    giverName: giver.name,
    createdAt: now,
    expiresAt,
  };
}

export function createInitialQuests(world: TownSnapshot): Quest[] {
  const rng = () => Math.random();
  // pick 4 diverse quests
  const shuffled = [...TEMPLATES].sort(() => rng() - 0.5);
  const chosen = shuffled.slice(0, 4);
  return chosen.map((tpl) => {
    const giver = pick(world.herd, rng);
    const id = "q" + Math.random().toString(36).slice(2, 9);
    const now = Date.now();
    return {
      id,
      title: tpl.title,
      description: tpl.description,
      category: tpl.category,
      type: tpl.type,
      targetPlace: tpl.targetPlace,
      targetPlaces: tpl.targetPlaces ? [...tpl.targetPlaces] : undefined,
      targetAgent: tpl.targetAgent,
      required: tpl.required,
      progress: 0,
      reward: tpl.reward,
      status: "available" as const,
      difficulty: tpl.difficulty,
      giver: giver.id,
      giverName: giver.name,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
    };
  });
}

export function updateQuestProgress(world: TownSnapshot, evt: { act: string; place: string; agentId: string; postKind?: string }): Quest[] {
  const updated: Quest[] = [];
  for (const q of world.quests) {
    if (q.status !== "active" && q.status !== "available") continue;
    // auto-activate available on first progress
    if (q.status === "available") q.status = "active";

    let matched = false;
    if (q.type === "visit" && q.targetPlace && evt.place === q.targetPlace) matched = true;
    if (q.type === "visit" && q.targetPlaces && q.targetPlaces.includes(evt.place)) {
      // for visit with multiple places, we track distinct? For simplicity, any visit to one of them counts, but we could require distinct — we count each visit
      matched = true;
    }
    if (q.type === "talk" && (evt.act === "talk" || evt.act === "argue")) {
      if (q.targetPlace && evt.place === q.targetPlace) matched = true;
      else if (!q.targetPlace) matched = true; // any talk
    }
    if (q.type === "explore" && q.targetPlaces && q.targetPlaces.includes(evt.place)) {
      // explore requires distinct places: we track visited set via progress+visited cache
      // store visited in quest as _visited hidden
      const anyQ = q as any;
      if (!anyQ._visited) anyQ._visited = new Set<string>();
      if (!anyQ._visited.has(evt.place)) {
        anyQ._visited.add(evt.place);
        matched = true;
        // progress is size of visited
        q.progress = anyQ._visited.size;
        if (q.progress >= q.required) {
          q.status = "completed";
          q.completedAt = Date.now();
          updated.push(q);
        }
        continue; // skip generic increment
      } else {
        matched = false;
      }
    }
    if (q.type === "fetch" && evt.act === "graze" && q.targetPlaces?.includes(evt.place)) matched = true;
    if (q.type === "work" && evt.act === "work") matched = true;
    if (q.type === "social" && evt.postKind && (evt.postKind === "post" || evt.postKind === "reply")) matched = true;

    if (matched && q.type !== "explore") {
      q.progress = Math.min(q.required, q.progress + 1);
      if (q.progress >= q.required) {
        q.status = "completed";
        q.completedAt = Date.now();
        updated.push(q);
      }
    }
  }
  return updated;
}

export function claimQuest(world: TownSnapshot, questId: string): { ok: boolean; quest?: Quest; error?: string } {
  const q = world.quests.find((x) => x.id === questId);
  if (!q) return { ok: false, error: "quest not found" };
  if (q.status !== "completed") return { ok: false, error: "quest not completed yet" };
  q.status = "claimed";
  // apply reward
  if (q.reward.spirits) {
    for (const h of world.herd) {
      h.mind.spirits = Math.min(1, Math.max(-1, h.mind.spirits + q.reward.spirits * 0.5));
    }
  }
  if (q.reward.progressBonus && world.projects[0]) {
    world.projects[0].progress = Math.min(1, world.projects[0].progress + q.reward.progressBonus);
  }
  // add to feed as event
  world.feed.unshift({
    id: "p" + Math.random().toString(36).slice(2, 9),
    t: Date.now(),
    by: q.giver,
    name: q.giverName,
    handle: "@" + q.giverName.toLowerCase(),
    text: `quest selesai: ${q.title} — ${q.reward.text}`,
    kind: "post",
    replyTo: null,
  });
  world.events.push({ t: Date.now(), kind: "quest", text: `${q.title} completed by town` });
  return { ok: true, quest: q };
}

export function refreshExpiredQuests(world: TownSnapshot): void {
  const now = Date.now();
  let expiredCount = 0;
  world.quests = world.quests.filter((q) => {
    if (q.expiresAt && now > q.expiresAt && q.status !== "completed" && q.status !== "claimed") {
      expiredCount++;
      return false;
    }
    return true;
  });
  // keep at least 3 active/available
  while (world.quests.filter((q) => q.status === "available" || q.status === "active").length < 3) {
    const nq = generateQuest(world);
    world.quests.push(nq);
  }
  // also cap at 6
  if (world.quests.length > 6) {
    world.quests = world.quests.slice(-6);
  }
}
