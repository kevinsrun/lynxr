import type { SupabaseClient } from '@supabase/supabase-js';
import { entries, remaining } from './contracts';
import type { Adaptation, Allowance, CreatorData, CreatorRow, Database } from './contracts';
import { parseVideoLink, videoCanon } from './video';

const ROW = 'id,data,updated_at';
const ATTEMPTS = 3;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class CreatorError extends Error {}

function writeError(code: string) {
  if (code === '23514') return new CreatorError('Your library is too large to save. Free up space on lynxr.io.');
  if (code === '42501' || code === 'PGRST301') return new CreatorError('This account cannot save to the library. Sign in again and retry.');
  return new CreatorError('We couldn’t confirm the save. Check your library or try again.');
}

function editableList<K extends 'library' | 'adaptations'>(data: CreatorData, key: K): NonNullable<CreatorData[K]> {
  const value = data[key];
  if (value != null && !Array.isArray(value)) {
    throw new CreatorError('Your library needs attention. Open it on lynxr.io before trying again.');
  }
  return (value ?? []) as NonNullable<CreatorData[K]>;
}

function sameVideo(sourceUrl: unknown, canon: string) {
  if (typeof sourceUrl !== 'string') return false;
  try {
    return videoCanon(new URL(sourceUrl)) === canon;
  } catch {
    return false;
  }
}

export function canRetry(job: Adaptation) {
  return job.status === 'error' && job.retryable !== false && job.retrying !== true;
}

export function creatorApi(client: SupabaseClient<Database>, userId: string, uuid: () => string) {
  async function read(): Promise<CreatorRow | null> {
    const { data, error } = await client.from('lynxr_creators').select(ROW).eq('id', userId).maybeSingle();
    if (error || (data && data.id !== userId)) throw new CreatorError('Couldn’t load your library. Try refreshing.');
    return data;
  }

  async function allowance(): Promise<Allowance> {
    const { data, error } = await client.rpc('my_allowance');
    if (error || !data || !Number.isFinite(data.used) || !Number.isFinite(data.granted)
      || (data.daily_max != null && (!Number.isFinite(data.daily_max)
        || (data.daily_max > 0 && !Number.isFinite(data.used_24h))))) {
      throw new CreatorError('Couldn’t check your script allowance. Try again.');
    }
    return data;
  }

  async function write(before: CreatorRow | null, data: CreatorData) {
    // Filter on the server's exact timestamp string; JS Date would lose microseconds.
    const { data: saved, error } = await (before
      ? client.from('lynxr_creators').update({ data }).eq('id', userId).eq('updated_at', before.updated_at)
      : client.from('lynxr_creators').insert({ id: userId, data }))
      .select('id').maybeSingle();
    if (error?.code === '23505' && !before) return false;
    if (error) throw writeError(error.code);
    return saved?.id === userId;
  }

  async function submit(raw: string): Promise<string> {
    const video = parseVideoLink(raw);
    if (!video) throw new CreatorError('Paste a full link to a TikTok video or Instagram reel.');
    const id = uuid();
    const libraryId = uuid();
    const entropy = uuid().slice(0, 8);
    const code = 'LYNX' + [0, 2, 4, 6].map((i) => CODE_ALPHABET[parseInt(entropy.slice(i, i + 2), 16) % 32]).join('');
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const row = await read();
      const data = row?.data ?? {};
      const jobs = editableList(data, 'adaptations');
      const old = jobs.filter((job) => job && !job.brandId && sameVideo(job.sourceUrl, video.canon));
      // A lost response, an in-flight request, or an existing failed job all lead
      // back to its card. A failed job must be explicitly retried with its old ID.
      const existing = old.find((job) => job.status !== 'error') ?? old[0];
      if (existing) return existing.id;
      if (remaining(await allowance()) === 0) throw new CreatorError('You’ve reached your script allowance.');
      const library = editableList(data, 'library');
      const item = library.find((entry) => entry?.canon === video.canon);
      const addedAt = new Date().toISOString();
      const job: Adaptation = {
        id, libraryId: item?.id ?? libraryId, sourceUrl: video.url, brandId: null, brandName: '',
        title: item?.title ?? '', addedAt, status: 'queued', code,
      };
      const next = {
        ...data,
        adaptations: [job, ...jobs],
        library: item ? library : [{
          id: libraryId, ...video, title: '', creator: '', caption: '', addedAt,
        }, ...library],
      };
      if (await write(row, next)) return id;
    }
    throw new CreatorError('Your library changed while saving. Try again.');
  }

  async function retry(id: string): Promise<void> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const row = await read();
      const job = entries(row?.data).find((entry) => entry.id === id);
      if (!row || !job) throw new CreatorError('This script is no longer in your library.');
      if (job.status === 'queued' || job.status === 'running' || job.status === 'done' || job.retrying) return;
      if (!canRetry(job) || !job.sourceUrl || !parseVideoLink(job.sourceUrl)) {
        throw new CreatorError('This script can’t be retried. Try another video.');
      }
      const queued = { ...job, status: 'queued' };
      for (const field of ['note', 'noteKind', 'attemptedAt', 'fetchFail', 'fetchClass', 'aiFail', 'retrying',
        'passes', 'final', 'finalWhy', 'phase', 'phaseAt', 'claimedAt', 'claimedBy']) {
        delete (queued as Adaptation)[field];
      }
      // A previously charged ID can still be eligible with zero room. Let
      // charge_scripts decide; the mobile client cannot inspect the ledger.
      const next = { ...row.data, adaptations: editableList(row.data, 'adaptations')
        .map((entry) => entry?.id === id ? queued : entry) };
      if (await write(row, next)) return;
    }
    throw new CreatorError('Your library changed while saving. Try again.');
  }

  return { read, allowance, submit, retry };
}

export type CreatorApi = ReturnType<typeof creatorApi>;
