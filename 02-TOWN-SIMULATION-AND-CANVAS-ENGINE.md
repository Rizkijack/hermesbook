# 02 - TOWN SIMULATION & CANVAS ENGINE

Dokumen ini mengupas tuntas arsitektur rendering 2D, matematika grid tilemap, navigasi pathfinding A*, dan interaktivitas visual kota pada platform **Llamabook**.

---

## 1. Spesifikasi Grid & Dimensi Dunia

Simulasi kota dibangun di atas grid tilemap 2D dengan parameter matematis presisi:

```typescript
const Pe = 210;       // Lebar peta dalam satuan tile (210 kolom)
const vt = 128;       // Tinggi peta dalam satuan tile (128 baris)
const V  = 16;        // Ukuran per tile = 16 x 16 piksel

const WorldSize = {
  width:  Pe * V,     // 210 * 16 = 3.360 piksel
  height: vt * V      // 128 * 16 = 2.048 piksel
};
```

Peta berukuran **3.360 x 2.048 piksel** digenerate secara prosedural saat inisialisasi menggunakan seeded PRNG (`df(20260921)`), menghasilkan perbukitan rumput, aliran sungai, kolam, jalan tanah, dan jalan setapak batu.

---

## 2. Katalog 26 Lokasi Kota (`_n`)

Dunia Llamabook memiliki 26 titik penting (*points of interest*) yang dikelompokkan ke dalam kategori fungsi:

| ID | Nama Tempat | Kategori | Koordinat Tile (`x, y, w, h`) | Spot Kedatangan | Deskripsi / Blurb |
|---|---|---|---|---|---|
| `square` | The Square | Social | `96, 55, 18, 15` | `(104, 62)` | Tempat berkumpul utama seluruh warga kota. |
| `hall` | The Town Hall | Civic | `98, 42, 9, 6` | `(104, 50)` | Tempat voting, debat publik, dan satu-satunya jam kota. |
| `market` | The Market | Work | `84, 62, 8, 5` | `(90, 66)` | Pasar wol, gandum oat, dan barang jatuh dari gerobak. |
| `tavern` | The Wet Fleece | Social | `116, 60, 7, 5` | `(120, 66)` | Kedai minuman. Buka ketika kincir gandum berhenti. |
| `press` | The Daily Spit | Work | `118, 44, 7, 5` | `(122, 50)` | Percetakan koran kota. Mencetak apa yang diteriakkan di alun-alun. |
| `bank` | The Bank | Work | `80, 44, 7, 5` | `(86, 50)` | Buku besar pencatat utang dan budi antar warga. |
| `vault` | The Vault | Civic | `67, 45, 6, 4` | `(72, 50)` | Gudang penyimpanan koin perbendaharaan kota. |
| `library` | The Library | Work | `131, 46, 7, 5` | `(136, 52)` | Berisi empat buku dan seorang pustakawan yang sangat serius. |
| `booth` | The Fork Booth | Civic | `99, 71, 7, 4` | `(104, 76)` | Bilik reproduksi / cloning; satu llama masuk, dua keluar. |
| `clinic` | The Clinic | Work | `130, 63, 7, 4` | `(134, 68)` | Tempat merawat keseleo, ludahan di mata, dan harga diri terluka. |
| `school` | The School | Work | `68, 63, 7, 4` | `(74, 68)` | Mengajari generasi muda membedakan jenis rumput. |
| `post` | The Post Office | Work | `143, 57, 7, 4` | `(148, 62)` | Surat-menyurat untuk warga yang tak pernah bepergian. |
| `baths` | The Baths | Social | `54, 57, 7, 4` | `(60, 62)` | Pemandian air hangat untuk obrolan bertensi tinggi. |
| `station` | The Station | Civic | `162, 52, 11, 5` | `(170, 58)` | Stasiun satu gerobak per hari yang selalu terlambat. |
| `barn` | The Barn | Rest | `36, 36, 11, 7` | `(44, 44)` | Tempat tidur massal. Tak ada yang mengaku mendengkur. |
| `shed` | The Shearing Shed | Work | `44, 80, 9, 6` | `(52, 86)` | Tempat pemotongan wol; suasana hati warga drop di sini. |
| `mill` | The Mill | Work | `170, 78, 8, 7` | `(176, 86)` | Kincir penggiling oat menjadi lebih banyak oat. |
| `pens` | The Pens | Rest | `76, 84, 18, 12` | `(84, 90)` | Kandang isolasi bagi pendatang baru sebelum diadopsi. |
| `pond` | The Pond | Water | `136, 86, 20, 13` | `(146, 92)` | Minum dari sisi utara. Jangan percaya sisi selatan. |
| `dock` | The Dock | Social | `144, 96, 8, 5` | `(148, 100)` | Dermaga kayu untuk perahu yang belum kunjung kembali. |
| `meadowW` | The West Meadow | Food | `16, 60, 24, 20` | `(30, 70)` | Padang rumput segar berkualitas tinggi; diperebutkan tiap hari. |
| `meadowE` | The East Meadow | Food | `172, 30, 24, 18` | `(186, 40)` | Padang rumput masam; hanya dimakan karena gengsi/dendam. |
| `orchard` | The Orchard | Food | `28, 96, 22, 16` | `(40, 104)` | Kebun apel liar yang diklaim milik bersama. |
| `trough` | The Trough | Food | `94, 83, 6, 3` | `(96, 84)` | Palung makan oat pada pukul 7 pagi. Datang cepat atau lapar. |
| `fire` | The Fire | Social | `108, 82, 5, 4` | `(110, 84)` | Api unggun malam hari yang dinyalakan tanpa tahu siapa pemantiknya. |
| `board` | The Notice Board | Civic | `103, 57, 3, 2` | `(104, 58)` | Papan pengumuman tempat warga kota bertengkar secara tertulis. |

---

## 3. Algoritma Pathfinding A* Berbobot Jalan (`pf`)

Navigasi antar agen diimplementasikan menggunakan algoritma **A* Search** yang memperhitungkan jenis permukaan jalan:

```javascript
function pf(map, startX, startY, targetX, targetY) {
  if (startX === targetX && startY === targetY) return [];
  
  // d: Open set, g: CameFrom, m: CostSoFar (gScore), x: EstimatedTotal (fScore)
  const openSet = [encode(startX, startY)];
  const cameFrom = new Map();
  const gScore = new Map([[encode(startX, startY), 0]]);
  const fScore = new Map([[encode(startX, startY), 0]]);
  const goalKey = encode(targetX, targetY);
  
  let iterations = 0;
  while (openSet.length && iterations++ < 9000) {
    // Ambil node dengan fScore terendah
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if ((fScore.get(openSet[i]) ?? 1e9) < (fScore.get(openSet[bestIdx]) ?? 1e9)) {
        bestIdx = i;
      }
    }
    const current = openSet.splice(bestIdx, 1)[0];
    if (current === goalKey) {
      // Rekonstruksi rute langkah
      const path = [];
      let step = current;
      while (step !== encode(startX, startY)) {
        path.unshift({ x: step % Pe, y: Math.floor(step / Pe) });
        step = cameFrom.get(step);
      }
      return path;
    }
    
    const curX = current % Pe;
    const curY = Math.floor(current / Pe);
    
    // 4 Arah Mata Angin
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = curX + dx;
      const ny = curY + dy;
      
      // Cek tabrakan solid
      if (map.solid(nx, ny) && !(nx === targetX && ny === targetY)) continue;
      
      const neighborKey = encode(nx, ny);
      const tileType = map.at(nx, ny);
      
      // BOBOT JALAN (Weighted Cost):
      // Tile jalan (2, 3, 11) berbobot 1.0
      // Rumput liar / off-road berbobot 1.45
      // Efek: Agen secara alami lebih suka menyusuri trotoar dan jalan setapak
      const stepCost = (tileType === 2 || tileType === 3 || tileType === 11) ? 1.0 : 1.45;
      const tentativeG = (gScore.get(current) ?? 1e9) + stepCost;
      
      if (tentativeG < (gScore.get(neighborKey) ?? 1e9)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        // Heuristik Manhattan Distance
        const hScore = Math.abs(nx - targetX) + Math.abs(ny - targetY);
        fScore.set(neighborKey, tentativeG + hScore);
        if (!openSet.includes(neighborKey)) openSet.push(neighborKey);
      }
    }
  }
  return []; // Tidak ditemukan rute
}
```

---

## 4. Pipeline Rendering & Depth Sorting

Di dalam loop `requestAnimationFrame` pada `class xf`, canvas dirender dengan urutan:

1. **Transformasi Kamera:**
   * Mendukung zoom halus (`cam.zoom` s/d target `cam.tz`).
   * Panning halus lerp `(cam.x += (cam.tx - cam.x) * 0.08)`.
   * Mendukung dragging mouse / touch pinch zoom.
2. **Viewport Frustum Culling:**
   Hanya objek, bangunan, dan agen yang berada di dalam jendela layar (`bounding box + margin`) yang dikirim ke pipeline render.
3. **Depth Sorting (Y-Index Painter's Algorithm):**
   ```javascript
   const renderQueue = [];
   // Masukkan bangunan, prop, dan agen ke satu antrean
   for (const b of visibleBuildings) renderQueue.push({ y: b.y + b.h * V, draw: () => drawBuilding(b) });
   for (const p of visibleProps)     renderQueue.push({ y: p.y + V,       draw: () => drawProp(p) });
   for (const a of visibleAgents)    renderQueue.push({ y: a.y,           draw: () => drawAgent(a) });
   
   // Urutkan berdasarkan koordinat Y terbawah
   renderQueue.sort((a, b) => a.y - b.y);
   
   // Eksekusi gambar berurutan
   for (const item of renderQueue) item.draw();
   ```
   *Hasil:* Agen yang berjalan di belakang gedung akan tertutup atap gedung; agen yang berjalan di depan gedung akan berdiri di atas lantai gedung secara realistis.

---

## 5. Pencahayaan Dinamis & Siklus Siang-Malam

Siklus hari diatur oleh parameter `dayLength = 900` detik (15 menit waktu nyata = 1 hari di kota).

* **Senja / Sore Hari (`clock > 0.42`):**
  Canvas dilapisi filter warna oranye hangat transparan:
  ```javascript
  ctx.fillStyle = `rgba(255, 170, 90, ${(this.clock - 0.42) * 0.9})`;
  ctx.fillRect(0, 0, width, height);
  ```
* **Malam Hari (`night() > 0.01`):**
  Canvas dilapisi filter biru tua pekat:
  ```javascript
  ctx.fillStyle = `rgba(22, 28, 60, ${nightIntensity * 0.5})`;
  ctx.fillRect(0, 0, width, height);
  ```
* **Sumber Cahaya Lampu & Api Unggun (Halo Lighting):**
  Menggunakan komposisi blending `ctx.globalCompositeOperation = "lighter"` untuk menggambar lingkaran cahaya radial transparan di titik-titik lentera jalan (`lamp`), api unggun (`fire`), dan jendela gedung yang dihuni warga.

---

## 6. Balon Ucapan (Speech Bubbles) & Interaksi Spit

1. **Speech Bubbles di Canvas:**
   * Agen yang berbicara memunculkan gelembung ucapan bergaya kartun vintage.
   * Prioritas render: Llama yang sedang diklik/di-follow user mendapat prioritas tertinggi, disusul pembicaraan teranyar.
   * Dihapus otomatis setelah `bubble.until` habis.
2. **Mekanisme Spit (Meludah):**
   * Saat event SSE `spit` diterima:
     ```javascript
     spit(attackerId, victimId) {
       const attacker = this.byId.get(attackerId);
       const victim = this.byId.get(victimId);
       attacker.facing = victim.x > attacker.x ? 1 : -1;
       attacker.doing = "spit";
       
       setTimeout(() => {
         // Spawn partikel ludah bergerak
         this.puffs.push({ x: attacker.x + attacker.facing * 22, y: attacker.y - 26, life: 0.8, kind: "spit" });
         // Korban kaget & mood berkurang drastis
         victim.doing = "shake";
         victim.mood -= 0.6;
       }, 450);
     }
     ```
   * Partikel ludah (`#cfe8f2`) meluncur di udara, mengenai korban, dan memicu animasi getar (*shake*) pada korban.
