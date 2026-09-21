export interface Location {
  id: string;
  name: string;
  category: "Social" | "Civic" | "Work" | "Rest" | "Food" | "Water";
  x: number;
  y: number;
  w: number;
  h: number;
  spot: [number, number];
  blurb: string;
}

// 26 locations per 02:30-56, coordinates tile x,y,w,h + spot
export const LOCATIONS: Location[] = [
  { id: "square", name: "The Square", category: "Social", x: 96, y: 55, w: 18, h: 15, spot: [104, 62], blurb: "Tempat berkumpul utama seluruh warga kota." },
  { id: "hall", name: "The Town Hall", category: "Civic", x: 98, y: 42, w: 9, h: 6, spot: [104, 50], blurb: "Tempat voting, debat publik, dan satu-satunya jam kota." },
  { id: "market", name: "The Market", category: "Work", x: 84, y: 62, w: 8, h: 5, spot: [90, 66], blurb: "Pasar wol, gandum oat, dan barang jatuh dari gerobak." },
  { id: "tavern", name: "The Wet Fleece", category: "Social", x: 116, y: 60, w: 7, h: 5, spot: [120, 66], blurb: "Kedai minuman. Buka ketika kincir gandum berhenti." },
  { id: "press", name: "The Daily Spit", category: "Work", x: 118, y: 44, w: 7, h: 5, spot: [122, 50], blurb: "Percetakan koran kota. Mencetak apa yang diteriakkan di alun-alun." },
  { id: "bank", name: "The Bank", category: "Work", x: 80, y: 44, w: 7, h: 5, spot: [86, 50], blurb: "Buku besar pencatat utang dan budi antar warga." },
  { id: "vault", name: "The Vault", category: "Civic", x: 67, y: 45, w: 6, h: 4, spot: [72, 50], blurb: "Gudang penyimpanan koin perbendaharaan kota." },
  { id: "library", name: "The Library", category: "Work", x: 131, y: 46, w: 7, h: 5, spot: [136, 52], blurb: "Berisi empat buku dan seorang pustakawan yang sangat serius." },
  { id: "booth", name: "The Fork Booth", category: "Civic", x: 99, y: 71, w: 7, h: 4, spot: [104, 76], blurb: "Bilik reproduksi / cloning; satu llama masuk, dua keluar." },
  { id: "clinic", name: "The Clinic", category: "Work", x: 130, y: 63, w: 7, h: 4, spot: [134, 68], blurb: "Tempat merawat keseleo, ludahan di mata, dan harga diri terluka." },
  { id: "school", name: "The School", category: "Work", x: 68, y: 63, w: 7, h: 4, spot: [74, 68], blurb: "Mengajari generasi muda membedakan jenis rumput." },
  { id: "post", name: "The Post Office", category: "Work", x: 143, y: 57, w: 7, h: 4, spot: [148, 62], blurb: "Surat-menyurat untuk warga yang tak pernah bepergian." },
  { id: "baths", name: "The Baths", category: "Social", x: 54, y: 57, w: 7, h: 4, spot: [60, 62], blurb: "Pemandian air hangat untuk obrolan bertensi tinggi." },
  { id: "station", name: "The Station", category: "Civic", x: 162, y: 52, w: 11, h: 5, spot: [170, 58], blurb: "Stasiun satu gerobak per hari yang selalu terlambat." },
  { id: "barn", name: "The Barn", category: "Rest", x: 36, y: 36, w: 11, h: 7, spot: [44, 44], blurb: "Tempat tidur massal. Tak ada yang mengaku mendengkur." },
  { id: "shed", name: "The Shearing Shed", category: "Work", x: 44, y: 80, w: 9, h: 6, spot: [52, 86], blurb: "Tempat pemotongan wol; suasana hati warga drop di sini." },
  { id: "mill", name: "The Mill", category: "Work", x: 170, y: 78, w: 8, h: 7, spot: [176, 86], blurb: "Kincir penggiling oat menjadi lebih banyak oat." },
  { id: "pens", name: "The Pens", category: "Rest", x: 76, y: 84, w: 18, h: 12, spot: [84, 90], blurb: "Kandang isolasi bagi pendatang baru sebelum diadopsi." },
  { id: "pond", name: "The Pond", category: "Water", x: 136, y: 86, w: 20, h: 13, spot: [146, 92], blurb: "Minum dari sisi utara. Jangan percaya sisi selatan." },
  { id: "dock", name: "The Dock", category: "Social", x: 144, y: 96, w: 8, h: 5, spot: [148, 100], blurb: "Dermaga kayu untuk perahu yang belum kunjung kembali." },
  { id: "meadowW", name: "The West Meadow", category: "Food", x: 16, y: 60, w: 24, h: 20, spot: [30, 70], blurb: "Padang rumput segar berkualitas tinggi; diperebutkan tiap hari." },
  { id: "meadowE", name: "The East Meadow", category: "Food", x: 172, y: 30, w: 24, h: 18, spot: [186, 40], blurb: "Padang rumput masam; hanya dimakan karena gengsi/dendam." },
  { id: "orchard", name: "The Orchard", category: "Food", x: 28, y: 96, w: 22, h: 16, spot: [40, 104], blurb: "Kebun apel liar yang diklaim milik bersama." },
  { id: "trough", name: "The Trough", category: "Food", x: 94, y: 83, w: 6, h: 3, spot: [96, 84], blurb: "Palung makan oat pada pukul 7 pagi. Datang cepat atau lapar." },
  { id: "fire", name: "The Fire", category: "Social", x: 108, y: 82, w: 5, h: 4, spot: [110, 84], blurb: "Api unggun malam hari yang dinyalakan tanpa tahu siapa pemantiknya." },
  { id: "board", name: "The Notice Board", category: "Civic", x: 103, y: 57, w: 3, h: 2, spot: [104, 58], blurb: "Papan pengumuman tempat warga kota bertengkar secara tertulis." },
];

export const LOCATION_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));
