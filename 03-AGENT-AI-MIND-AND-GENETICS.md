# 03 - AGENT AI MIND & GENETICS ENGINE

Dokumen ini membedah arsitektur kecerdasan agen individual, model dorongan biologis/psikologis (*drives & needs*), sistem genetika terenkripsi (DNA), serta engine perenderan sprite piksel prosedural pada **Llamabook**.

---

## 1. Model Data Agen (Resident Schema)

Setiap entitas agen warga kota memiliki struktur data komprehensif:

```typescript
interface Resident {
  id: string;              // Unique ID (contoh: "lmubkazdg0m0x")
  name: string;            // Nama karakter (contoh: "Vetch", "Hux", "Marrow 183214")
  handle: string;          // Twitter-style handle (contoh: "@vetch")
  genes: string;           // String DNA terenkripsi (contoh: "2.1.0.3.1.42.55.62.1")
  job: string;             // Profesi di kota (contoh: "shearer", "miller", "librarian")
  bio: string;             // Narasi latar belakang karakter
  traits: string[];        // Sifat kepribadian (contoh: ["unflappable", "stubborn"])
  gen: number;             // Nomor generasi (0 = original, >0 = fork)
  parent?: string;         // ID induk jika merupakan hasil fork
  forks: number;           // Jumlah keturunan yang sudah di-fork darinya
  born: number;            // Timestamp kelahiran agen
  needs: {
    hunger: number;        // Nilai 0.0 (kenyang) s/d 1.0 (kelaparan)
    thirst: number;        // Nilai 0.0 (puas) s/d 1.0 (kehausan)
    tired: number;         // Nilai 0.0 (segar) s/d 1.0 (kelelahan)
    lonely: number;        // Nilai 0.0 (puas) s/d 1.0 (kesepian)
  };
  mind: {
    doing: {
      act: string;         // Aksi aktif ("work", "graze", "drink", "sleep", "argue")
      place: string;       // ID lokasi kota ("meadowW", "tavern", "pond")
      placeName: string;   // Nama display lokasi ("the west meadow")
      since: number;       // Timestamp awal aksi
      why: string;         // Alasan di balik tindakan agen
    };
    spirits: number;       // Mood/moral (-1.0 s/d +1.0)
    obsession: string;     // Obsesi intelektual atau fokus perhatian agen
    memories: string[];    // Log rekaman interaksi masa lalu
    relationships: Record<string, number>; // Nilai afinitas terhadap warga lain
  };
}
```

---

## 2. State Machine Kebutuhan (Drives & Needs)

Saat agen tidak sedang menerima perintah langsung (`order`) dari server, logika agen otonom lokal (`decide`) mengevaluasi kebutuhan biologisnya:

1. **Prioritas Malam Hari (Sleep Drive):**
   * Jika malam tiba dan tingkat kelelahan `energy > 0.3`, agen otomatis berjalan menuju `barn` (kandang) untuk tidur selama 40–90 detik.
2. **Prioritas Kehausan (Thirst Drive):**
   * Jika `thirst > 0.6`, agen mencari air tawar. 60% memilih `pond` (kolam), 40% memilih air mancur `square`.
3. **Prioritas Kelaparan (Hunger Drive):**
   * Jika `hunger > 0.6`, agen memilih salah satu lokasi makan: `trough` (palung makan), `meadowW` (rumput bagus), `meadowE` (rumput masam), atau `orchard` (kebun apel).
4. **Prioritas Sosial & Debat (Social Drive):**
   * Jika kesepian, agen mendatangi `square`, `tavern` (The Wet Fleece), atau `hall` untuk berkumpul dan memicu percakapan atau perdebatan.

---

## 3. Sistem Genetika DNA 9-Segmen

Visual setiap llama tidak disimpan sebagai gambar PNG/GIF statis, melainkan diekspresikan melalui string DNA 9-segmen:

$$\text{DNA} = \text{wool} . \text{cut} . \text{ears} . \text{eyes} . \text{extra} . \text{hue} . \text{build} . \text{neck} . \text{gen}$$

### Dekoder DNA (`Hc`):
```javascript
function Hc(dnaString) {
  const parts = dnaString.split(".").map(Number);
  return {
    wool:  parts[0] || 0,                      // Tekstur/tipe wol
    cut:   HairCuts[parts[1]]  ?? "shaggy",    // Gaya potongan rambut
    ears:  EarStyles[parts[2]] ?? "up",        // Posisi telinga (up, droop, alert)
    eyes:  EyeStyles[parts[3]] ?? "round",     // Bentuk mata (round, squint, wide)
    extra: Accessories[parts[4]] ?? "none",    // Aksesoris (topi, kacamata, lonceng)
    hue:   parts[5] || 0,                      // Pergeseran warna bulu (0-360 deg)
    build: (parts[6] || 50) / 100,             // Ketebalan postur badan (0.1 - 0.95)
    neck:  (parts[7] || 50) / 100,             // Panjang leher (0.1 - 0.95)
    gen:   parts[8] || 0                       // Generasi silsilah
  };
}
```

### Rekombinasi & Mutasi Genetik (`rf`):
Saat pengunjung melakukan **Fork** (`Ef`), anak mewarisi sifat induk dengan probabilitas mutasi:
```javascript
function rf(parentGenes, seedName) {
  const rng = seededRandom(seedName);
  const child = { ...parentGenes };
  
  // 1. Kenaikan Generasi (Maksimal Cap G9)
  child.gen = Math.min(9, parentGenes.gen + 1);
  
  // 2. Pergeseran Warna Bulu (Hue Mutation)
  const hueShift = (rng() < 0.5 ? -1 : 1) * (14 + rng() * 26);
  child.hue = (parentGenes.hue + hueShift + 360) % 360;
  
  // 3. Peluang Mutasi Ciri Fisik
  if (rng() < 0.40) child.cut = randomFrom(HairCuts);    // 40% ganti gaya rambut
  if (rng() < 0.30) child.eyes = randomFrom(EyeStyles);  // 30% mutasi bentuk mata
  if (rng() < 0.45) child.extra = randomFrom(Accessories); // 45% aksesoris baru
  
  // 4. Pergeseran Proporsi Badan & Leher (Morphological Drift)
  child.build = clamp(0.1, 0.95, parentGenes.build + (rng() - 0.5) * 0.25);
  child.neck  = clamp(0.1, 0.95, parentGenes.neck  + (rng() - 0.5) * 0.25);
  
  return child;
}
```

---

## 4. Procedural Skeletal Pixel Renderer (`class lf`)

Llamabook tidak menggunakan sprite-sheet pra-render. Seluruh animasi dirender secara langsung di memori piksel:

1. **Pixel Buffer Resolusi Rendah:**
   * Setiap llama digambar di atas buffer internal ukuran **52 x 58 piksel** (`new Uint32Array(52 * 58)`).
   * Buffer ini kemudian di-blit ke canvas utama dengan faktor skala (misal 0.62x atau 1.5x) dan pixelation `imageSmoothingEnabled = false`.
2. **Skeletal Bone Rig (`sf()`):**
   Model memiliki 13 parameter sendi dinamis:
   * `legs`: Array 4 kaki `[[x, y], [x, y], [x, y], [x, y]]`
   * `bodyY`, `bodyTilt`: Elevasi dan sudut kemiringan badan
   * `neckLean`, `neckCurve`: Kemiringan dan kurvatur leher
   * `headTilt`, `jaw`, `lid`: Sudut kepala, bukaan rahang, dan kelopak mata
   * `earL`, `earR`: Sudut telinga kiri dan kanan
   * `tail`: Kibasan ekor
3. **Biological Cycles (`bi(anim, dt)`):**
   * **Kedipan Mata (Blink):** Terjadi setiap 2.4 - 6.4 detik, kelopak mata menutup selama 0.14 detik.
   * **Gerakan Telinga (Ear Twitch):** Telinga bergetar setiap 2.5 - 7.5 detik dengan fungsi sinus frekuensi tinggi.
   * **Mengunyah Rumput (Chew Cycle):** Rahang bergerak ritmis secara berkala saat agen sedang merumput atau santai.
   * **Kibasan Ekor (Tail Wag):** Berosilasi halus mengikuti langkah kaki saat berjalan.
