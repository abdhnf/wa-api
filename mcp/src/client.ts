/**
 * Klien HTTP ke wa-api.
 *
 * Semua panggilan lewat sini, tidak ada yang memanggil `fetch` langsung. Alasannya
 * bukan kerapian: dua hal harus dijamin untuk SETIAP permintaan, dan keduanya
 * mudah terlupa kalau ditulis per-tool —
 *
 *   1. `X-MCP-Actor` ikut terkirim. Tanpa header ini, GET yang berhasil tidak
 *      dicatat di `api_logs`, sehingga aksi agen tidak meninggalkan jejak audit.
 *   2. Galat diterjemahkan dengan cara yang sama: `403` dari wa-api TIDAK boleh
 *      menjadi "sesi tidak ada", karena dua hal itu berbeda dan pemanggil
 *      berhak tahu bedanya.
 */

export type Konfigurasi = {
  baseUrl: string;
  apiKey: string;
  actor: string;
  /** Batas waktu satu permintaan. Tool tulis bisa memicu reconnect; beri ruang. */
  timeoutMs: number;
};

/**
 * Galat yang membawa status HTTP apa adanya.
 *
 * `status` sengaja disimpan terpisah dari pesan supaya pemanggil bisa membedakan
 * 401 (kunci salah), 403 (bukan milikmu), dan 404 (tidak ada) tanpa membaca teks.
 */
export class GalatApi extends Error {
  constructor(
    readonly status: number,
    readonly pesanAsli: string,
    readonly jalur: string,
  ) {
    super(pesanAsli);
    this.name = 'GalatApi';
  }
}

export function bacaKonfigurasi(): Konfigurasi {
  const baseUrl = (process.env.WA_API_BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
  const apiKey = process.env.WA_API_KEY || '';
  if (!apiKey) {
    // Gagal di awal, bukan saat tool pertama dipanggil. Pesan yang jelas di sini
    // menghemat satu sesi debugging: klien MCP akan menampilkan galat ini saat
    // proses dijalankan, bukan sebagai 401 misterius di tengah percakapan.
    throw new Error(
      'WA_API_KEY belum diisi. Server MCP memakai API key milik pengguna yang menjalankan agen; ' +
        'tanpa kunci ia tidak bisa memanggil wa-api sama sekali.',
    );
  }
  return {
    baseUrl,
    apiKey,
    actor: process.env.WA_MCP_ACTOR || 'mcp',
    timeoutMs: Number(process.env.WA_API_TIMEOUT_MS || 20000),
  };
}

type OpsiPermintaan = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Jalur setelah `/api/v1`, mis. `/sessions/sess-1/metrics`. */
  jalur: string;
  body?: unknown;
};

export function buatKlien(konfig: Konfigurasi) {
  async function panggil<T>({ method, jalur, body }: OpsiPermintaan): Promise<T> {
    const url = `${konfig.baseUrl}/api/v1${jalur}`;
    const pengendali = new AbortController();
    const jam = setTimeout(() => pengendali.abort(), konfig.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: pengendali.signal,
        headers: {
          'X-API-Key': konfig.apiKey,
          'X-MCP-Actor': konfig.actor,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err: any) {
      // Dua kegagalan berbeda: timeout (AbortError) dan backend mati
      // (ECONNREFUSED). Keduanya dilaporkan sebagai "backend tidak dapat
      // dihubungi", tetapi pesannya dibedakan supaya tidak menyesatkan.
      const sebab = err?.name === 'AbortError'
        ? `permintaan melebihi ${konfig.timeoutMs} ms`
        : (err?.cause?.code || err?.code || err?.message || 'tidak diketahui');
      throw new Error(
        `wa-api tidak dapat dihubungi (${konfig.baseUrl}): ${sebab}. ` +
          'Periksa apakah backend berjalan; server MCP tidak mencoba ulang sendiri.',
      );
    } finally {
      clearTimeout(jam);
    }

    const teks = await res.text();

    if (!res.ok) {
      // Pesan asli dari wa-api diteruskan apa adanya. Menafsirkannya di sini akan
      // menyembunyikan perbedaan antara "bukan milikmu" dan "tidak ada".
      let pesan = teks;
      try {
        const j = JSON.parse(teks);
        if (j && typeof j.error === 'string') pesan = j.error;
        else if (j && typeof j.message === 'string') pesan = j.message;
      } catch {
        /* bukan JSON — pakai teks mentah */
      }
      throw new GalatApi(res.status, pesan.slice(0, 500) || `HTTP ${res.status}`, jalur);
    }

    if (!teks) return undefined as T;
    try {
      return JSON.parse(teks) as T;
    } catch {
      throw new Error(`Respons wa-api bukan JSON untuk ${jalur}: ${teks.slice(0, 200)}`);
    }
  }

  return {
    get: <T>(jalur: string) => panggil<T>({ method: 'GET', jalur }),
    post: <T>(jalur: string, body?: unknown) => panggil<T>({ method: 'POST', jalur, body: body ?? {} }),
    put: <T>(jalur: string, body: unknown) => panggil<T>({ method: 'PUT', jalur, body }),
    patch: <T>(jalur: string, body: unknown) => panggil<T>({ method: 'PATCH', jalur, body }),
  };
}

export type Klien = ReturnType<typeof buatKlien>;
